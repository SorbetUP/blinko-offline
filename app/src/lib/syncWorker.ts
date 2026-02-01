import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { BaseStore } from '@/store/baseStore';
import { createRemoteClient } from './trpcSmartClient';
import { cacheReplaceLocalWithServer, deletePendingOp, listPendingOps } from './localDb';
import { isInTauri } from './tauriHelper';
import { getSyncEnabled, getSyncEndpoint, getSyncToken } from './syncConfig';

let started = false;
let syncTick: (() => Promise<void>) | null = null;

const getRawFetch = () => {
  return (globalThis as any).__BLINKO_RAW_FETCH || fetch;
};

export const startSyncWorker = () => {
  if (!isInTauri()) return;
  if (started) return;
  started = true;

  const remote = () => {
    const endpoint = getSyncEndpoint();
    const token = getSyncToken();
    return createRemoteClient({
      useStream: false,
      baseUrl: endpoint.endsWith('/api/trpc') ? endpoint : `${endpoint.replace(/\/$/, '')}/api/trpc`,
      getHeaders: () => (token ? { Authorization: `Bearer ${token}` } : {}),
      fetchFn: getRawFetch(),
    }) as any;
  };

  const tick = async () => {
    const userStore = RootStore.Get(UserStore);
    const baseStore = RootStore.Get(BaseStore);

    const userId = userStore.id;
    if (!userId) return;
    if (!getSyncEnabled()) return;
    if (!getSyncEndpoint()) return;
    if (!getSyncToken()) return;

    const pending = await listPendingOps(userId);
    if (!pending.length) return;

    const client = remote();
    for (const op of pending) {
      try {
        const note: any = op.note;
        const serverId = note?.metadata?.serverId ?? null;

        const res = await client.notes.upsert.mutate({
          id: serverId ? Number(serverId) : undefined,
          content: note.content,
          type: note.type,
          isArchived: note.isArchived,
          isRecycle: note.isRecycle,
          isTop: note.isTop,
          isShare: note.isShare,
          attachments: note.attachments,
          references: (note.references ?? []).map((ref: any) => ref.toNoteId ?? ref),
          metadata: note.metadata,
        });

        await cacheReplaceLocalWithServer(userId, op.localId, res);
        await deletePendingOp(userId, op.localId);
        if (!isInTauri()) {
          baseStore.setOnlineStatus(true);
        }
      } catch {
        if (!isInTauri()) {
          baseStore.setOnlineStatus(false);
        }
        break;
      }
    }
  };

  syncTick = tick;
  setInterval(() => void tick(), 10_000);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void tick());
  }
};

export const runSyncNow = async () => {
  if (syncTick) {
    await syncTick();
  }
};
