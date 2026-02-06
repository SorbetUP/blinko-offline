import { observer } from 'mobx-react-lite';
import { Button, Input, Card, CardBody, Switch, Tabs, Tab, Chip, Progress, Divider, Tooltip } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { RootStore } from '@/store';
import { DialogStore } from '@/store/module/Dialog';
import { ProviderIcon } from '@/components/BlinkoSettings/AiSetting/AIIcon';
import { AiProvider, AiSettingStore } from '@/store/aiSettingStore';
import { PROVIDER_TEMPLATES } from './constants';
import { Copy } from '@/components/Common/Copy';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import { isInTauri } from '@/lib/tauriHelper';
import {
  ollamaDeleteModel,
  ollamaInstallManaged,
  ollamaListModels,
  ollamaPullModel,
  ollamaStart,
  ollamaStatus,
  ollamaStop,
  ollamaUpdateManaged,
  type OllamaInstallProgress,
  type OllamaLog,
  type OllamaModelInfo,
  type OllamaPullProgress,
  type OllamaStatus,
} from '@/lib/ollamaManaged';

interface ProviderDialogContentProps {
  provider?: AiProvider;
}

// Steps indicator component
const StepsIndicator = ({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) => {
  return (
    <div className="flex items-center justify-center mb-8">
      {Array.from({ length: totalSteps }, (_, index) => (
        <div key={index} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${index + 1 <= currentStep
              ? 'bg-primary text-primary-foreground'
              : 'bg-default-100 text-default-500'
              }`}
          >
            {index + 1}
          </div>
          {index < totalSteps - 1 && (
            <div
              className={`w-12 h-0.5 mx-2 transition-all ${index + 1 < currentStep ? 'bg-primary' : 'bg-default-200'
                }`}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default observer(function ProviderDialogContent({ provider }: ProviderDialogContentProps) {
  const { t } = useTranslation();
  const aiSettingStore = RootStore.Get(AiSettingStore);
  const toast = RootStore.Get(ToastPlugin);
  const [currentStep, setCurrentStep] = useState(provider ? 2 : 1);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(provider?.provider || '');

  const [editingProvider, setEditingProvider] = useState<Partial<AiProvider>>(() => {
    if (provider) {
      return { ...provider };
    }
    return {
      id: 0,
      title: '',
      provider: '',
      baseURL: '',
      apiKey: '',
      sortOrder: 0,
      models: []
    };
  });

  const providerType = (editingProvider.provider || selectedTemplate || '').toLowerCase();
  const isOllama = providerType === 'ollama';
  const isOpenAI = providerType === 'openai';
  const isAnthropic = providerType === 'anthropic';

  const [providerConfigTab, setProviderConfigTab] = useState<'connection' | 'local'>('connection');
  const [ollamaShowLogs, setOllamaShowLogs] = useState(false);

  const [ollamaInfo, setOllamaInfo] = useState<{
    status: OllamaStatus | null;
    installProgress: OllamaInstallProgress | null;
    pullProgress: OllamaPullProgress | null;
    logs: string[];
    models: OllamaModelInfo[];
    modelToPull: string;
    busy: boolean;
  }>({
    status: null,
    installProgress: null,
    pullProgress: null,
    logs: [],
    models: [],
    modelToPull: '',
    busy: false
  });

  // Initialize editing mode if provider exists
  useEffect(() => {
    if (provider) {
      setCurrentStep(2);
      setSelectedTemplate(provider.provider);
    }
  }, [provider]);

  useEffect(() => {
    if (!isOllama && providerConfigTab === 'local') {
      setProviderConfigTab('connection');
    }
  }, [isOllama, providerConfigTab]);

  const refreshOllamaStatus = async () => {
    try {
      const endpoint = (editingProvider.baseURL || '').trim() || 'http://127.0.0.1:11434';
      const status = await ollamaStatus(endpoint);
      setOllamaInfo(prev => ({ ...prev, status }));
    } catch (e: any) {
      toast.error(e?.message || String(e));
    }
  };

  useEffect(() => {
    if (!isOllama) return;
    if (!isInTauri()) return;

    let mounted = true;
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');

        const un1 = await listen<OllamaInstallProgress>('ollama:install-progress', (event) => {
          if (!mounted) return;
          setOllamaInfo(prev => ({ ...prev, installProgress: event.payload || null }));
        });
        unlisteners.push(un1);

        const un2 = await listen<OllamaPullProgress>('ollama:pull-progress', (event) => {
          if (!mounted) return;
          setOllamaInfo(prev => ({ ...prev, pullProgress: event.payload || null }));
        });
        unlisteners.push(un2);

        const un3 = await listen<OllamaLog>('ollama:log', (event) => {
          if (!mounted) return;
          const p = event.payload as OllamaLog;
          if (!p?.line) return;
          setOllamaInfo(prev => ({
            ...prev,
            logs: [`[${p.stream}] ${p.line}`, ...prev.logs].slice(0, 50)
          }));
        });
        unlisteners.push(un3);
      } catch (e) {
        console.error('Failed to setup Ollama listeners:', e);
      }
    };

    setup();
    refreshOllamaStatus();

    return () => {
      mounted = false;
      unlisteners.forEach(fn => {
        try {
          fn();
        } catch {}
      });
    };
  }, [isOllama]);

  const handleTemplateSelect = (templateValue: string) => {
    if (templateValue === 'custom') {
      setSelectedTemplate('custom');
      setEditingProvider(prev => ({
        ...prev,
        provider: 'custom',
        title: 'Custom Provider',
        baseURL: 'https://api.example.com/v1'
      }));
    } else {
      const template = PROVIDER_TEMPLATES.find(t => t.value === templateValue);
      if (template) {
        setSelectedTemplate(templateValue);
        setEditingProvider(prev => ({
          ...prev,
          provider: template.value,
          title: template.defaultName,
          baseURL: template.defaultBaseURL
        }));
      }
    }
    setCurrentStep(2);
  };

  const handleSaveProvider = async () => {
    if (!editingProvider) return;

    if (editingProvider.id) {
      await aiSettingStore.updateProvider.call(editingProvider as any);
    } else {
      await aiSettingStore.createProvider.call(editingProvider as any);
    }
    RootStore.Get(DialogStore).close();
  };

  // Step 1: Provider Selection
  const renderProviderSelection = () => (
    <div className="space-y-6">
      {/* Custom Configuration Option */}
      <Card
        shadow='none'
        isPressable
        className="hover:bg-default-50 transition-colors cursor-pointer bg-secondbackground w-full"
        onPress={() => handleTemplateSelect('custom')}
      >
        <CardBody className="flex flex-row items-center gap-4 p-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center relative">
              <ProviderIcon provider="openai" className="w-6 h-6 text-primary" />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                <Icon icon="hugeicons:settings-03" className="w-2.5 h-2.5 text-primary" />
              </div>
            </div>
          </div>
          <div className="flex-1">
            <h4 className="font-medium">{t('custom-configuration')}</h4>
            <p className="text-sm text-default-500">{t('configure-your-own-api-endpoint')}</p>
          </div>
          <Icon icon="hugeicons:arrow-right-02" className="w-5 h-5 text-default-400" />
        </CardBody>
      </Card>

      {/* Provider Templates */}
      <div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PROVIDER_TEMPLATES.map((template) => {
            return (
              <Card
                shadow='none'
                key={template.value}
                isPressable
                className="hover:bg-default-50 transition-colors cursor-pointer bg-secondbackground"
                onPress={() => handleTemplateSelect(template.value)}
              >
                <CardBody className="flex flex-row items-center gap-3 p-4">
                  <div className="flex-shrink-0">
                    <ProviderIcon provider={template.value} className="w-8 h-8" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h5 className="font-medium truncate">{template.label}</h5>
                    <p className="text-xs text-default-500 line-clamp-2">{template.description}</p>
                  </div>
                  <Icon icon="hugeicons:arrow-right-02" className="w-4 h-4 text-default-400" />
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );

  // Step 2: Configuration
  const renderConfiguration = () => {
    const template = PROVIDER_TEMPLATES.find((t) => t.value === selectedTemplate);
    const ollamaManaged = (editingProvider.config as any)?.ollamaManaged ?? true;

    const authMode = (editingProvider.config as any)?.authMode || 'api-key';
    const usesEnvApiKey = (isOpenAI || isAnthropic) && authMode === 'env';
    const usesCodexCli = isOpenAI && authMode === 'codex-cli';
    const usesClaudeCodeCli = isAnthropic && authMode === 'claude-code-cli';
    const usesCliAuth = usesCodexCli || usesClaudeCodeCli;

    const apiKeyEnvVar =
      ((editingProvider.config as any)?.apiKeyEnvVar as string | undefined) ||
      (isOpenAI ? 'OPENAI_API_KEY' : isAnthropic ? 'ANTHROPIC_API_KEY' : '');
    const cliPath = ((editingProvider.config as any)?.cliPath as string | undefined) || '';

    const setAuthModeValue = (value: string) => {
      setEditingProvider((prev) => ({
        ...prev,
        apiKey: value === 'api-key' ? (prev.apiKey || '') : '',
        config: {
          ...(prev.config as any || {}),
          authMode: value,
          apiKeyEnvVar:
            value === 'env'
              ? ((prev.config as any)?.apiKeyEnvVar || (isOpenAI ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'))
              : (prev.config as any)?.apiKeyEnvVar,
          cliPath:
            value.endsWith('-cli')
              ? ((prev.config as any)?.cliPath || '')
              : (prev.config as any)?.cliPath,
        },
      }));
    };

    const connectionPanel = (
      <div className="space-y-4">
        <Card shadow="none" className="bg-secondbackground">
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-default-700">
              <Icon icon="hugeicons:settings-02" width="16" height="16" />
              <span>{t('provider-settings-basic')}</span>
            </div>

            <Input
              label={t('provider-name')}
              placeholder={t('enter-provider-name')}
              value={editingProvider.title || ''}
              onValueChange={(value) => {
                setEditingProvider((prev) => ({ ...prev, title: value }));
              }}
            />
          </CardBody>
        </Card>

        {(isOpenAI || isAnthropic) && (
          <Card shadow="none" className="bg-secondbackground">
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-default-700">
                <Icon icon="hugeicons:shield-user" width="16" height="16" />
                <span>{t('auth-method')}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Card
                  shadow="none"
                  isPressable
                  className={`bg-default-50 border ${authMode === 'api-key' ? 'border-primary' : 'border-default-200 hover:border-default-300'}`}
                  onPress={() => setAuthModeValue('api-key')}
                >
                  <CardBody className="p-3">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 ${authMode === 'api-key' ? 'text-primary' : 'text-default-500'}`}>
                        <Icon icon="hugeicons:key-01" width="18" height="18" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{t('auth-api-key')}</div>
                          {authMode === 'api-key' && (
                            <Chip size="sm" color="primary" variant="flat">
                              {t('active')}
                            </Chip>
                          )}
                        </div>
                        <div className="text-xs text-default-500">
                          {t('auth-api-key-desc')}
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>

                <Card
                  shadow="none"
                  isPressable
                  className={`bg-default-50 border ${authMode === 'env' ? 'border-primary' : 'border-default-200 hover:border-default-300'}`}
                  onPress={() => setAuthModeValue('env')}
                >
                  <CardBody className="p-3">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 ${authMode === 'env' ? 'text-primary' : 'text-default-500'}`}>
                        <Icon icon="hugeicons:code-01" width="18" height="18" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{t('auth-env-var')}</div>
                          {authMode === 'env' && (
                            <Chip size="sm" color="primary" variant="flat">
                              {t('active')}
                            </Chip>
                          )}
                        </div>
                        <div className="text-xs text-default-500">
                          {t('auth-env-var-desc')}
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>

                {isOpenAI && (
                  <Card
                    shadow="none"
                    isPressable
                    className={`bg-default-50 border ${authMode === 'codex-cli' ? 'border-primary' : 'border-default-200 hover:border-default-300'}`}
                    onPress={() => setAuthModeValue('codex-cli')}
                  >
                    <CardBody className="p-3">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 ${authMode === 'codex-cli' ? 'text-primary' : 'text-default-500'}`}>
                          <Icon icon="hugeicons:terminal-01" width="18" height="18" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{t('auth-codex-cli')}</div>
                            {authMode === 'codex-cli' && (
                              <Chip size="sm" color="primary" variant="flat">
                                {t('active')}
                              </Chip>
                            )}
                          </div>
                          <div className="text-xs text-default-500">
                            {t('auth-codex-cli-desc')}
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                )}

                {isAnthropic && (
                  <Card
                    shadow="none"
                    isPressable
                    className={`bg-default-50 border ${authMode === 'claude-code-cli' ? 'border-primary' : 'border-default-200 hover:border-default-300'}`}
                    onPress={() => setAuthModeValue('claude-code-cli')}
                  >
                    <CardBody className="p-3">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 ${authMode === 'claude-code-cli' ? 'text-primary' : 'text-default-500'}`}>
                          <Icon icon="hugeicons:terminal-01" width="18" height="18" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{t('auth-claude-code-cli')}</div>
                            {authMode === 'claude-code-cli' && (
                              <Chip size="sm" color="primary" variant="flat">
                                {t('active')}
                              </Chip>
                            )}
                          </div>
                          <div className="text-xs text-default-500">
                            {t('auth-claude-code-cli-desc')}
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                )}
              </div>

              {usesEnvApiKey && (
                <div className="space-y-2">
                  <Divider />
                  <Input
                    label={t('env-var-name')}
                    placeholder={isOpenAI ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}
                    value={apiKeyEnvVar}
                    onValueChange={(value) => {
                      setEditingProvider((prev) => ({
                        ...prev,
                        config: {
                          ...(prev.config as any || {}),
                          apiKeyEnvVar: value,
                        },
                      }));
                    }}
                  />
                  <div className="text-xs text-default-500 leading-5">
                    {t('auth-env-var-hint')}
                  </div>
                </div>
              )}

              {usesCliAuth && (
                <div className="space-y-2">
                  <Divider />
                  <div className="flex items-center gap-2 text-sm font-medium text-default-700">
                    <Icon icon="hugeicons:terminal-02" width="16" height="16" />
                    <span>{t('cli-setup')}</span>
                    <Chip size="sm" color="warning" variant="flat">
                      {t('experimental')}
                    </Chip>
                  </div>
                  <Input
                    label={t('cli-path')}
                    placeholder={usesCodexCli ? 'codex' : 'claude'}
                    value={cliPath}
                    onValueChange={(value) => {
                      setEditingProvider((prev) => ({
                        ...prev,
                        config: {
                          ...(prev.config as any || {}),
                          cliPath: value,
                        },
                      }));
                    }}
                  />
                  <div className="text-xs text-default-500 leading-5">
                    {usesCodexCli ? t('auth-codex-cli-hint') : t('auth-claude-code-cli-hint')}
                  </div>
                  <div className="rounded-md bg-default-50 border border-default-200 p-3 text-xs text-default-600 leading-5">
                    <div className="font-medium text-default-700 mb-1">{t('cli-requirements')}</div>
                    <div>1. {t('cli-requirements-1')}</div>
                    <div>2. {t('cli-requirements-2')}</div>
                    <div>3. {t('cli-requirements-3')}</div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {!usesCliAuth && (
          <Card shadow="none" className="bg-secondbackground">
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-default-700">
                <Icon icon="hugeicons:link-04" width="16" height="16" />
                <span>{t('provider-connection')}</span>
              </div>

              <Input
                label={t('base-url')}
                placeholder={t('enter-api-base-url')}
                value={editingProvider.baseURL || ''}
                onValueChange={(value) => {
                  setEditingProvider((prev) => ({ ...prev, baseURL: value }));
                }}
              />

              {!usesEnvApiKey && (
                <Input
                  label={t('api-key')}
                  placeholder={t('enter-api-key')}
                  type="password"
                  value={editingProvider.apiKey || ''}
                  onValueChange={(value) => {
                    setEditingProvider((prev) => ({ ...prev, apiKey: value }));
                  }}
                  endContent={<Copy size={20} content={editingProvider.apiKey ?? ''} />}
                />
              )}
            </CardBody>
          </Card>
        )}

        {(editingProvider.provider === 'azure' || editingProvider.provider === 'azureopenai') && (
          <Card shadow="none" className="bg-secondbackground">
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-default-700">
                <Icon icon="hugeicons:settings-01" width="16" height="16" />
                <span>{t('advanced')}</span>
              </div>
              <Input
                label={t('api-version')}
                placeholder="2024-02-01"
                value={editingProvider.config?.apiVersion || ''}
                onValueChange={(value) => {
                  setEditingProvider((prev) => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      apiVersion: value,
                    },
                  }));
                }}
              />
            </CardBody>
          </Card>
        )}
      </div>
    );

    const localOllamaPanel = (() => {
      if (!isOllama) return null;

      const rawEndpoint = (editingProvider.baseURL || '').trim() || 'http://127.0.0.1:11434';
      const endpoint = rawEndpoint.replace(/[\s\u200B\uFEFF\u200E\u200F]+/g, '');
      const status = ollamaInfo.status;
      const running = !!status?.running;
      const managedSupported = !!status?.managed_supported;

      const installPercent = typeof ollamaInfo.installProgress?.percent === 'number'
        ? Math.max(0, Math.min(100, ollamaInfo.installProgress!.percent!))
        : null;
      const pullPercent =
        typeof ollamaInfo.pullProgress?.completed === 'number' && typeof ollamaInfo.pullProgress?.total === 'number' && ollamaInfo.pullProgress.total > 0
          ? Math.max(0, Math.min(100, (ollamaInfo.pullProgress.completed / ollamaInfo.pullProgress.total) * 100))
          : null;

      return (
        <div className="space-y-4">
          <Card shadow="none" className="bg-secondbackground">
            <CardBody className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{t('ollama-integrated-server')}</div>
                    <Chip size="sm" color={running ? 'success' : 'default'} variant="flat">
                      {running ? t('ollama-status-running') : t('ollama-status-stopped')}
                    </Chip>
                    {status?.managed_installed ? (
                      <Chip size="sm" color="primary" variant="flat">
                        {t('installed')}
                      </Chip>
                    ) : (
                      <Chip size="sm" color="warning" variant="flat">
                        {t('not-installed')}
                      </Chip>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-xs text-default-500 min-w-0">
                    <span className="truncate">
                      {t('provider-effective-endpoint')}: <span className="font-mono">{endpoint}</span>
                    </span>
                    <Copy size={16} content={endpoint} />
                  </div>

                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-default-600">
                    <div className="rounded-md bg-default-50 border border-default-200 p-2">
                      <div className="text-default-500">{t('server-version')}</div>
                      <div className="font-mono">{status?.server_version ? `v${status.server_version}` : '-'}</div>
                    </div>
                    <div className="rounded-md bg-default-50 border border-default-200 p-2">
                      <div className="text-default-500">{t('managed-version')}</div>
                      <div className="font-mono">{status?.managed_version ? `v${status.managed_version}` : '-'}</div>
                    </div>
                    <div className="rounded-md bg-default-50 border border-default-200 p-2">
                      <div className="text-default-500">{t('latest-version')}</div>
                      <div className="font-mono">{status?.latest_version ? `v${status.latest_version}` : '-'}</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Button size="sm" variant="flat" isDisabled={!isInTauri() || ollamaInfo.busy} onPress={refreshOllamaStatus}>
                    {t('refresh')}
                  </Button>
                  {!isInTauri() && (
                    <div className="text-[11px] text-default-500 max-w-48 text-right">
                      {t('ollama-managed-mode-desktop-only')}
                    </div>
                  )}
                </div>
              </div>

              {status?.last_error && (
                <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700">
                  <div className="flex items-center gap-2 font-medium">
                    <Icon icon="hugeicons:alert-02" width="14" height="14" />
                    <span>{t('error')}</span>
                  </div>
                  <div className="mt-1 font-mono whitespace-pre-wrap break-words">{status.last_error}</div>
                </div>
              )}

              <Divider />

              <div className="flex flex-col gap-1">
                <Switch
                  isSelected={!!ollamaManaged}
                  isDisabled={!isInTauri() || (status ? !status.managed_supported : false)}
                  onValueChange={(value) => {
                    setEditingProvider((prev) => ({
                      ...prev,
                      config: {
                        ...(prev.config as any || {}),
                        ollamaManaged: value,
                      },
                    }));
                  }}
                >
                  {t('ollama-managed-mode')}
                </Switch>

                <div className="text-xs text-default-500">
                  {isInTauri() ? t('ollama-managed-mode-desc') : t('ollama-managed-mode-desktop-only')}
                </div>

                {status && !managedSupported && (
                  <div className="text-xs text-danger">
                    {t('ollama-managed-not-supported')}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Tooltip content={!ollamaManaged ? t('ollama-managed-required') : undefined}>
                  <Button
                    size="sm"
                    variant="flat"
                    isDisabled={!isInTauri() || ollamaInfo.busy || !ollamaManaged || !managedSupported || running}
                    onPress={async () => {
                      try {
                        setOllamaInfo((prev) => ({ ...prev, busy: true, installProgress: null }));
                        const s = await ollamaInstallManaged();
                        setOllamaInfo((prev) => ({ ...prev, status: s }));
                        await refreshOllamaStatus();
                      } catch (e: any) {
                        toast.error(e?.message || String(e));
                      } finally {
                        setOllamaInfo((prev) => ({ ...prev, busy: false }));
                      }
                    }}
                  >
                    {t('install')}
                  </Button>
                </Tooltip>

                <Tooltip content={!ollamaManaged ? t('ollama-managed-required') : undefined}>
                  <Button
                    size="sm"
                    variant="flat"
                    isDisabled={!isInTauri() || ollamaInfo.busy || !ollamaManaged || !managedSupported || running}
                    onPress={async () => {
                      try {
                        setOllamaInfo((prev) => ({ ...prev, busy: true, installProgress: null }));
                        const s = await ollamaUpdateManaged();
                        setOllamaInfo((prev) => ({ ...prev, status: s }));
                        await refreshOllamaStatus();
                      } catch (e: any) {
                        toast.error(e?.message || String(e));
                      } finally {
                        setOllamaInfo((prev) => ({ ...prev, busy: false }));
                      }
                    }}
                  >
                    {t('update')}
                  </Button>
                </Tooltip>

                <Button
                  size="sm"
                  color="primary"
                  isDisabled={!isInTauri() || ollamaInfo.busy}
                  onPress={async () => {
                    try {
                      if ((editingProvider.baseURL || '').trim() !== endpoint) {
                        setEditingProvider((prev) => ({ ...prev, baseURL: endpoint }));
                      }
                      setOllamaInfo((prev) => ({ ...prev, busy: true }));
                      const s = await ollamaStart(endpoint);
                      setOllamaInfo((prev) => ({ ...prev, status: s }));
                    } catch (e: any) {
                      toast.error(e?.message || String(e));
                    } finally {
                      setOllamaInfo((prev) => ({ ...prev, busy: false }));
                    }
                  }}
                >
                  {t('start')}
                </Button>

                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  isDisabled={!isInTauri() || ollamaInfo.busy}
                  onPress={async () => {
                    try {
                      setOllamaInfo((prev) => ({ ...prev, busy: true }));
                      const s = await ollamaStop();
                      setOllamaInfo((prev) => ({ ...prev, status: s }));
                    } catch (e: any) {
                      toast.error(e?.message || String(e));
                    } finally {
                      setOllamaInfo((prev) => ({ ...prev, busy: false }));
                    }
                  }}
                >
                  {t('stop')}
                </Button>
              </div>

              {ollamaInfo.installProgress && (
                <div className="space-y-2">
                  <div className="text-xs text-default-500">
                    {t('progress')}: {ollamaInfo.installProgress.stage} - {ollamaInfo.installProgress.message}
                  </div>
                  <Progress
                    size="sm"
                    value={installPercent ?? undefined}
                    isIndeterminate={installPercent == null}
                    color="primary"
                  />
                </div>
              )}

              <Divider />

              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <Input
                    label={t('ollama-model-to-pull')}
                    placeholder="llama3.2"
                    value={ollamaInfo.modelToPull}
                    onValueChange={(value) => setOllamaInfo((prev) => ({ ...prev, modelToPull: value }))}
                  />

                  <Button
                    size="sm"
                    color="primary"
                    isDisabled={!isInTauri() || ollamaInfo.busy || !ollamaInfo.modelToPull.trim()}
                    onPress={async () => {
                      try {
                        if ((editingProvider.baseURL || '').trim() !== endpoint) {
                          setEditingProvider((prev) => ({ ...prev, baseURL: endpoint }));
                        }
                        setOllamaInfo((prev) => ({ ...prev, busy: true, pullProgress: null }));
                        await ollamaPullModel(endpoint, ollamaInfo.modelToPull);
                        const models = await ollamaListModels(endpoint);
                        setOllamaInfo((prev) => ({ ...prev, models }));
                      } catch (e: any) {
                        toast.error(e?.message || String(e));
                      } finally {
                        setOllamaInfo((prev) => ({ ...prev, busy: false }));
                      }
                    }}
                  >
                    {t('pull')}
                  </Button>

                  <Button
                    size="sm"
                    variant="flat"
                    isDisabled={!isInTauri() || ollamaInfo.busy}
                    onPress={async () => {
                      try {
                        if ((editingProvider.baseURL || '').trim() !== endpoint) {
                          setEditingProvider((prev) => ({ ...prev, baseURL: endpoint }));
                        }
                        setOllamaInfo((prev) => ({ ...prev, busy: true }));
                        const models = await ollamaListModels(endpoint);
                        setOllamaInfo((prev) => ({ ...prev, models }));
                      } catch (e: any) {
                        toast.error(e?.message || String(e));
                      } finally {
                        setOllamaInfo((prev) => ({ ...prev, busy: false }));
                      }
                    }}
                  >
                    {t('list')}
                  </Button>
                </div>

                {ollamaInfo.pullProgress && (
                  <div className="space-y-2">
                    <div className="text-xs text-default-500">
                      {t('progress')}: {ollamaInfo.pullProgress.status || ''}
                    </div>
                    <Progress
                      size="sm"
                      value={pullPercent ?? undefined}
                      isIndeterminate={pullPercent == null && !ollamaInfo.pullProgress.done}
                      color="primary"
                    />
                  </div>
                )}

                {ollamaInfo.models.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs text-default-500">
                      {t('installed-models')} ({ollamaInfo.models.length})
                    </div>
                    <div className="max-h-56 overflow-auto rounded-md border border-default-200 bg-default-50">
                      <div className="flex flex-col divide-y divide-default-200">
                        {ollamaInfo.models.slice(0, 50).map((m) => (
                          <div key={m.name} className="flex items-center justify-between gap-3 p-2 text-xs">
                            <div className="min-w-0">
                              <div className="font-mono truncate">{m.name}</div>
                              <div className="text-[11px] text-default-500">
                                {m.size ? `${Math.round(m.size / (1024 * 1024))}MB` : ''}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              color="danger"
                              variant="light"
                              isDisabled={!isInTauri() || ollamaInfo.busy}
                              onPress={async () => {
                                try {
                                  setOllamaInfo((prev) => ({ ...prev, busy: true }));
                                  await ollamaDeleteModel(endpoint, m.name);
                                  const models = await ollamaListModels(endpoint);
                                  setOllamaInfo((prev) => ({ ...prev, models }));
                                } catch (e: any) {
                                  toast.error(e?.message || String(e));
                                } finally {
                                  setOllamaInfo((prev) => ({ ...prev, busy: false }));
                                }
                              }}
                            >
                              {t('delete')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                    {ollamaInfo.models.length > 50 && (
                      <div className="text-xs text-default-400">{t('showing-first-n', { n: 50 })}</div>
                    )}
                  </div>
                )}

              </div>

              <Divider />

              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-default-700">{t('logs')}</div>
                <Button
                  size="sm"
                  variant="flat"
                  isDisabled={!isInTauri()}
                  onPress={() => setOllamaShowLogs((v) => !v)}
                >
                  {ollamaShowLogs ? t('hide') : t('show')}
                </Button>
              </div>

              {ollamaShowLogs && (
                <div className="max-h-48 overflow-auto rounded-md bg-default-50 border border-default-200 p-2 text-[11px] font-mono text-default-700">
                  {ollamaInfo.logs.length === 0 ? (
                    <div className="text-default-500">{t('no-data')}</div>
                  ) : (
                    ollamaInfo.logs.map((l, idx) => (
                      <div key={idx} className="whitespace-pre-wrap break-words">
                        {l}
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      );
    })();

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-3 mb-4">
          <ProviderIcon provider={selectedTemplate} className="w-8 h-8" />
          <h3 className="text-lg font-semibold">
            {selectedTemplate === 'custom' ? t('custom-configuration') : template?.label}
          </h3>
        </div>

        <Tabs
          aria-label="Provider configuration tabs"
          selectedKey={providerConfigTab}
          onSelectionChange={(key) => setProviderConfigTab(String(key) as any)}
        >
          <Tab
            key="connection"
            title={
              <div className="flex items-center gap-2">
                <Icon icon="hugeicons:link-04" width="16" height="16" />
                <span>{t('provider-tab-connection')}</span>
              </div>
            }
          >
            {connectionPanel}
          </Tab>
          {isOllama && (
            <Tab
              key="local"
              title={
                <div className="flex items-center gap-2">
                  <Icon icon="hugeicons:server-01" width="16" height="16" />
                  <span>{t('provider-tab-local')}</span>
                </div>
              }
            >
              {localOllamaPanel}
            </Tab>
          )}
        </Tabs>
      </div>
    );
  };

  return (
    <div className="mx-auto w-full">
      {/* Steps Indicator */}
      <StepsIndicator currentStep={currentStep} totalSteps={2} />

      {/* Content */}
      <div className="min-h-[400px]">
        {currentStep === 1 && renderProviderSelection()}
        {currentStep === 2 && renderConfiguration()}
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center pt-6 border-t border-default-200">
        <div>
          {currentStep > 1 && (
            <Button
              variant="flat"
              startContent={<Icon icon="hugeicons:arrow-left-02" width="16" height="16" />}
              onPress={() => setCurrentStep(currentStep - 1)}
            >
              {t('back')}
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          {currentStep === 2 && (
            <Button color="primary" onPress={handleSaveProvider}>
              {editingProvider.id ? t('update') : t('create')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
