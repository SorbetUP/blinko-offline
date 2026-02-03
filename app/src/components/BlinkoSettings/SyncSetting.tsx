import { useEffect, useState } from 'react';
import { Button, Input, Select, SelectItem } from '@heroui/react';
import { observer } from 'mobx-react-lite';
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint, saveBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { isInTauri } from '@/lib/tauriHelper';
import { invoke } from '@tauri-apps/api/core';

const MODES = [
  { key: 'local', label: 'Local' },
  { key: 'remote', label: 'Remote' },
  { key: 'sync', label: 'Sync' },
];

export const SyncSetting = observer(() => {
  const [mode, setMode] = useState('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await axiosInstance.get(getBlinkoEndpoint('/sync/settings'));
        const data = res.data || {};
        setMode(data.mode || 'local');
        const endpoint = (data.remote_endpoints || [])[0];
        if (endpoint) {
          setRemoteUrl(endpoint.url || '');
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
      const remote_endpoints = remoteUrl
        ? [{ id: 'default', url: remoteUrl, token: remoteToken || undefined }]
        : [];
      await axiosInstance.put(getBlinkoEndpoint('/sync/settings'), {
        mode,
        remote_endpoints,
      });
      if (isInTauri()) {
        if (mode === 'remote' && remoteUrl) {
          saveBlinkoEndpoint(remoteUrl);
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

      <Input
        label="Remote base URL"
        placeholder="https://example.com"
        value={remoteUrl}
        onChange={(e) => setRemoteUrl(e.target.value)}
      />

      <Input
        label="Remote token"
        placeholder="token"
        value={remoteToken}
        onChange={(e) => setRemoteToken(e.target.value)}
      />

      <div className="flex gap-2">
        <Button color="primary" isLoading={loading} onPress={saveSettings}>
          Save
        </Button>
        <Button variant="flat" isLoading={syncing} onPress={syncNow}>
          Sync now
        </Button>
        <Button variant="flat" isLoading={syncing} onPress={importFromRemote}>
          Import
        </Button>
        <Button variant="flat" isLoading={syncing} onPress={exportToRemote}>
          Export
        </Button>
      </div>
    </div>
  );
});
