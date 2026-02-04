import { useEffect, useState } from 'react';
import { Button, Input, Select, SelectItem } from '@heroui/react';
import { observer } from 'mobx-react-lite';
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint, saveBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { isInTauri } from '@/lib/tauriHelper';
import { invoke } from '@tauri-apps/api/core';

const MODES = [
  { key: 'local', label: 'Local', description: 'Keep data on this device only.' },
  { key: 'remote', label: 'Remote', description: 'Use a remote Blinko server for data.' },
  { key: 'sync', label: 'Sync', description: 'Keep local data and sync with remote.' },
];

export const SyncSetting = observer(() => {
  const [mode, setMode] = useState('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const normalizeRemoteUrl = (value: string) => value.trim().replace(/\/+$/, '');

  const validateRemoteUrl = (value: string) =>
    value.startsWith('http://') || value.startsWith('https://');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await axiosInstance.get(getBlinkoEndpoint('/sync/settings'));
        const data = res.data || {};
        setMode(data.mode || 'local');
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
      const remote_endpoints = normalizedUrl
        ? [{ id: 'default', url: normalizedUrl, token: remoteToken || undefined }]
        : [];
      await axiosInstance.put(getBlinkoEndpoint('/sync/settings'), {
        mode,
        remote_endpoints,
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
      setTestMessage('Please enter a full URL starting with http:// or https://');
      setTesting(false);
      return;
    }
    try {
      const health = await fetch(`${normalizedUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!health.ok) {
        throw new Error(`Health check failed (${health.status})`);
      }
      if (remoteToken) {
        const profile = await fetch(`${normalizedUrl}/api/auth/profile`, {
          headers: { Authorization: `Bearer ${remoteToken}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!profile.ok) {
          throw new Error(`Token invalid (${profile.status})`);
        }
      }
      setTestStatus('ok');
      setTestMessage(
        remoteToken
          ? 'Remote reachable and token valid.'
          : 'Remote reachable. Add a token to test auth.'
      );
    } catch (error) {
      setTestStatus('error');
      setTestMessage(error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Select
        label="Sync mode"
        selectedKeys={[mode]}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as string;
          if (value) setMode(value);
        }}
      >
        {MODES.map((item) => (
          <SelectItem key={item.key}>{item.label}</SelectItem>
        ))}
      </Select>

      <div className="text-sm text-default-500">
        {MODES.find((item) => item.key === mode)?.description}
      </div>

      {(mode === 'remote' || mode === 'sync') && (
        <>
          <Input
            label="Remote base URL"
            placeholder="https://your-blinko.example.com"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
          />

          <Input
            label="Remote token"
            placeholder="Paste your API token"
            type="password"
            value={remoteToken}
            onChange={(e) => setRemoteToken(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <Button variant="flat" isLoading={testing} onPress={testRemoteConnection}>
              Test connection
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
        </>
      )}

      <div className="flex gap-2">
        <Button color="primary" isLoading={loading} onPress={saveSettings}>
          Save
        </Button>
        {mode === 'sync' && (
          <>
            <Button variant="flat" isLoading={syncing} onPress={syncNow}>
              Sync now
            </Button>
            <Button variant="flat" isLoading={syncing} onPress={importFromRemote}>
              Import
            </Button>
            <Button variant="flat" isLoading={syncing} onPress={exportToRemote}>
              Export
            </Button>
          </>
        )}
      </div>
    </div>
  );
});
