import { observer } from 'mobx-react-lite';
import { Button, Input, Switch } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';
import { Item } from './Item';
import { CollapsibleCard } from '@/components/Common/CollapsibleCard';
import { runSyncNow } from '@/lib/syncWorker';
import { getSyncEnabled, getSyncEndpoint, getSyncToken, setSyncToken } from '@/lib/syncConfig';
import { getRemoteEndpoint } from '@/lib/blinkoEndpoint';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import { useEffect } from 'react';

const getRawFetch = () => {
  return (globalThis as any).__BLINKO_RAW_FETCH || fetch;
};

export const SyncSetting = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const toast = RootStore.Get(ToastPlugin);

  const store = RootStore.Local(() => ({
    syncEnabled: false,
    endpoint: '',
    username: '',
    password: '',
    syncToken: '',
    loading: false,
  }));

  const loadConfig = () => {
    const cfg = blinko.config.value || {};
    store.syncEnabled = Boolean(cfg.syncEnabled ?? getSyncEnabled());
    store.endpoint = String(cfg.syncEndpoint || getSyncEndpoint() || '').trim();
    store.syncToken = getSyncToken();
  };

  const connect = async () => {
    if (!store.endpoint || !store.username || !store.password) {
      toast.error(t('sync-missing-fields'));
      return;
    }
    store.loading = true;
    const endpoint = store.endpoint.replace(/\/$/, '');
    const rawFetch = getRawFetch();
    try {
      await PromiseCall(api.config.update.mutate({ key: 'syncEndpoint', value: endpoint }), { autoAlert: false });
      const loginRes = await rawFetch(`${endpoint}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: store.username, password: store.password }),
      });
      let data = await loginRes.json().catch(() => null);

      if (!loginRes.ok) {
        const registerRes = await rawFetch(`${endpoint}/api/v1/user/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: store.username, password: store.password }),
        });
        if (!registerRes.ok) {
          throw new Error(data?.error || 'register_failed');
        }
        const retry = await rawFetch(`${endpoint}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: store.username, password: store.password }),
        });
        data = await retry.json();
        if (!retry.ok) {
          throw new Error(data?.error || 'login_failed');
        }
      }

      if (!data?.token) {
        throw new Error('token_missing');
      }
      setSyncToken(String(data.token));
      store.syncToken = String(data.token);
      await PromiseCall(api.config.update.mutate({ key: 'syncEnabled', value: true }), { autoAlert: false });
      toast.success(t('sync-connected'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      store.loading = false;
    }
  };

  const handleSyncNow = async () => {
    try {
      await runSyncNow();
      toast.success(t('sync-started'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!blinko.config.value) {
      blinko.config.call().then(loadConfig).catch(() => {});
    } else {
      loadConfig();
    }
  }, [blinko.config.value]);

  return (
    <CollapsibleCard icon="fluent:arrow-sync-24-filled" title={t('sync-settings')}>
      <Item
        leftContent={<div>{t('sync-enabled')}</div>}
        rightContent={
          <Switch
            isSelected={store.syncEnabled}
            onValueChange={async (value) => {
              store.syncEnabled = value;
              await PromiseCall(api.config.update.mutate({ key: 'syncEnabled', value }), { autoAlert: false });
            }}
          />
        }
      />

      <Item
        leftContent={<div>{t('sync-endpoint')}</div>}
        rightContent={
          <Input
            value={store.endpoint}
            onChange={(e) => {
              store.endpoint = e.target.value;
            }}
            placeholder="http://127.0.0.1:1111"
            onBlur={async (e) => {
              await PromiseCall(api.config.update.mutate({ key: 'syncEndpoint', value: e.target.value.trim() }), { autoAlert: false });
            }}
          />
        }
      />

      <Item
        leftContent={<div>{t('sync-username')}</div>}
        rightContent={
          <Input
            value={store.username}
            onChange={(e) => {
              store.username = e.target.value;
            }}
            placeholder={t('username')}
          />
        }
      />

      <Item
        leftContent={<div>{t('sync-password')}</div>}
        rightContent={
          <Input
            type="password"
            value={store.password}
            onChange={(e) => {
              store.password = e.target.value;
            }}
            placeholder={t('password')}
          />
        }
      />

      <Item
        leftContent={<div>{t('sync-status')}</div>}
        rightContent={
          <div className="flex items-center gap-2">
            <div className="text-sm text-desc">
              {store.syncToken ? t('sync-connected') : t('sync-disconnected')}
            </div>
            <Button size="sm" color="primary" isLoading={store.loading} onPress={connect}>
              {t('sync-connect')}
            </Button>
            <Button size="sm" variant="flat" onPress={handleSyncNow}>
              {t('sync-now')}
            </Button>
          </div>
        }
      />
      <Item
        leftContent={<div>{t('sync-remote-url')}</div>}
        rightContent={
          <div className="text-xs text-desc break-all">
            {getRemoteEndpoint('') || t('sync-remote-not-set')}
          </div>
        }
      />
    </CollapsibleCard>
  );
});
