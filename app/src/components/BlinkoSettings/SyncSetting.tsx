import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Radio, RadioGroup, Switch } from '@heroui/react';
import { observer } from 'mobx-react-lite';
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint, saveBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { isInTauri } from '@/lib/tauriHelper';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

const MODE_KEYS = ['local', 'remote', 'sync'] as const;
type ModeKey = typeof MODE_KEYS[number];

export const SyncSetting = observer(() => {
  const { t } = useTranslation();
  const [mode, setMode] = useState('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false);

  const normalizeRemoteUrl = (value: string) => value.trim().replace(/\/+$/, '');

  const validateRemoteUrl = (value: string) =>
    value.startsWith('http://') || value.startsWith('https://');

  const isPrivateHost = (host: string) => {
    if (host === 'localhost') return true;
    const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return false;
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  };

  const isLanHttp = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' && isPrivateHost(url.hostname);
    } catch {
      return false;
    }
  };

  const modes = useMemo(() => ([
    { key: 'local', label: t('sync-mode-local'), description: t('sync-mode-local-desc') },
    { key: 'remote', label: t('sync-mode-remote'), description: t('sync-mode-remote-desc') },
    { key: 'sync', label: t('sync-mode-sync'), description: t('sync-mode-sync-desc') },
  ]), [t]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await axiosInstance.get(getBlinkoEndpoint('/sync/settings'));
        const data = res.data || {};
        setMode(data.mode || 'local');
        setAllowInsecureHttp(!!data.allow_insecure_http);
        const endpoint = (data.remote_endpoints || [])[0];
        if (endpoint) {
          setRemoteUrl(normalizeRemoteUrl(endpoint.url || ''));
          setRemoteToken(endpoint.token || '');
        }
      } catch (error) {
        console.error('Failed to load sync settings:', error);
      }
    };
    loadSettings();
  }, []);

  const saveSettings = async () => {
    setLoading(true);
    try {
      const normalizedUrl = normalizeRemoteUrl(remoteUrl);
      setRemoteUrl(normalizedUrl);
      if (normalizedUrl && normalizedUrl.startsWith('http://') && !(allowInsecureHttp && isLanHttp(normalizedUrl))) {
        setTestStatus('error');
        setTestMessage(t('sync-http-lan-only'));
        return;
      }
      const remote_endpoints = normalizedUrl
        ? [{ id: 'default', url: normalizedUrl, token: remoteToken || undefined }]
        : [];
      await axiosInstance.put(getBlinkoEndpoint('/sync/settings'), {
        mode,
        remote_endpoints,
        allow_insecure_http: allowInsecureHttp,
      });
      if (isInTauri()) {
        if (mode === 'remote' && normalizedUrl) {
          saveBlinkoEndpoint(normalizedUrl);
        } else {
          const localBase = await invoke<string | null>('get_local_api_base_url');
          if (localBase) {
            saveBlinkoEndpoint(localBase);
          }
        }
      }
    } catch (error) {
      console.error('Failed to save sync settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      if (isInTauri()) {
        await invoke('sync_now');
      } else {
        await axiosInstance.post(getBlinkoEndpoint('/sync/now'));
      }
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  const importFromRemote = async () => {
    setSyncing(true);
    try {
      if (isInTauri() && remoteUrl) {
        await invoke('import_remote_to_local_cmd', { remoteUrl, token: remoteToken || null });
      }
    } catch (error) {
      console.error('Import failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  const exportToRemote = async () => {
    setSyncing(true);
    try {
      if (isInTauri() && remoteUrl) {
        await invoke('export_local_to_remote_cmd', { remoteUrl, token: remoteToken || null });
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  const testRemoteConnection = async () => {
    setTesting(true);
    setTestStatus('idle');
    setTestMessage('');
    const normalizedUrl = normalizeRemoteUrl(remoteUrl);
    if (!normalizedUrl || !validateRemoteUrl(normalizedUrl)) {
      setTestStatus('error');
      setTestMessage(t('sync-url-invalid'));
      setTesting(false);
      return;
    }
    if (normalizedUrl.startsWith('http://') && !(allowInsecureHttp && isLanHttp(normalizedUrl))) {
      setTestStatus('error');
      setTestMessage(t('sync-http-lan-only'));
      setTesting(false);
      return;
    }
    try {
      // Test via backend/local-api to avoid WebView CSP + mixed-content restrictions.
      await axiosInstance.post(getBlinkoEndpoint('/sync/test'), {
        remote_url: normalizedUrl,
        token: remoteToken || undefined,
        allow_insecure_http: allowInsecureHttp,
      });
      setTestStatus('ok');
      setTestMessage(
        remoteToken
          ? t('sync-test-ok-token')
          : t('sync-test-ok-no-token')
      );
    } catch (error) {
      setTestStatus('error');
      const fallback = t('sync-test-failed');
      // Try to surface backend error messages (axios)
      const message =
        (error as any)?.response?.data?.error ||
        (error as any)?.message ||
        fallback;
      if (normalizedUrl.startsWith('https://') && (() => {
        try {
          return isPrivateHost(new URL(normalizedUrl).hostname);
        } catch {
          return false;
        }
      })()) {
        setTestMessage(t('sync-test-lan-https-hint'));
      } else {
        setTestMessage(message || fallback);
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-default-200 p-4">
        <div className="text-sm font-medium">{t('sync-mode-title')}</div>
        <RadioGroup
          className="mt-2"
          value={mode}
          onValueChange={(value) => setMode(value)}
        >
          {modes.map((item) => (
            <Radio key={item.key} value={item.key}>
              <div className="flex flex-col">
                <span className="font-medium">{item.label}</span>
                <span className="text-xs text-default-500">{item.description}</span>
              </div>
            </Radio>
          ))}
        </RadioGroup>
      </div>

      {(mode === 'remote' || mode === 'sync') && (
        <div className="rounded-lg border border-default-200 p-4">
          <div className="text-sm font-medium">{t('sync-server-settings')}</div>

          <div className="mt-3 flex flex-col gap-3">
            <Input
              label={t('sync-remote-base-url')}
              placeholder={t('sync-remote-base-url-placeholder')}
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
            />

            <Input
              label={t('sync-remote-token')}
              placeholder={t('sync-remote-token-placeholder')}
              type="password"
              value={remoteToken}
              onChange={(e) => setRemoteToken(e.target.value)}
            />

            <div className="flex flex-col gap-1">
              <Switch isSelected={allowInsecureHttp} onValueChange={setAllowInsecureHttp}>
                {t('sync-allow-http-lan')}
              </Switch>
              <span className="text-xs text-default-500">
                {t('sync-allow-http-lan-desc')}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="flat" isLoading={testing} onPress={testRemoteConnection}>
                {t('sync-test-connection')}
              </Button>
              {testStatus !== 'idle' && (
                <span
                  className={
                    testStatus === 'ok' ? 'text-success text-sm' : 'text-danger text-sm'
                  }
                >
                  {testMessage}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-default-200 p-4">
        <div className="text-sm font-medium">{t('sync-actions')}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button color="primary" isLoading={loading} onPress={saveSettings}>
            {t('save')}
          </Button>
          {mode === 'sync' && (
            <>
              <Button variant="flat" isLoading={syncing} onPress={syncNow}>
                {t('sync-now')}
              </Button>
              <Button variant="flat" isLoading={syncing} onPress={importFromRemote}>
                {t('sync-import')}
              </Button>
              <Button variant="flat" isLoading={syncing} onPress={exportToRemote}>
                {t('sync-export')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
