import { observer } from 'mobx-react-lite';
import { RootStore } from '@/store';
import { SyncStore } from '@/store/sync/syncStore';
import { SyncQueueStore } from '@/store/sync/syncQueueStore';
import { BaseStore } from '@/store/baseStore';
import { Icon } from '@/components/Common/Iconify/icons';
import { motion, AnimatePresence } from 'motion/react';

export const SyncStatusIndicator = observer(() => {
  const syncStore = RootStore.Get(SyncStore);
  const syncQueueStore = RootStore.Get(SyncQueueStore);
  const baseStore = RootStore.Get(BaseStore);
  const pendingCount = syncStore.isSyncing ? syncStore.pendingCount : syncQueueStore.pendingCount;

  // Only show indicator when syncing or when offline mode detected during manual refresh
  if (!syncStore.isSyncing && pendingCount === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 right-4 z-[999] bg-background border-2 border-border rounded-lg shadow-lg p-3 flex items-center gap-2"
      >
        {/* Only show offline message during sync when offline */}
        {!baseStore.isOnline && syncStore.isSyncing && (
          <>
            <Icon icon="mdi:wifi-off" width="20" height="20" className="text-warning" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Impossible de mettre à jour</span>
              <span className="text-xs text-muted-foreground">
                Mode hors ligne
              </span>
            </div>
          </>
        )}

        {baseStore.isOnline && syncStore.isSyncing && (
          <>
            <Icon icon="line-md:loading-loop" width="20" height="20" className="text-primary" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Synchronisation...</span>
              {pendingCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {Math.round(syncStore.syncProgress)}% ({pendingCount} restantes)
                </span>
              )}
            </div>
          </>
        )}

        {baseStore.isOnline && !syncStore.isSyncing && pendingCount > 0 && (
          <>
            <Icon icon="mdi:sync-alert" width="20" height="20" className="text-warning" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">En attente</span>
              <span className="text-xs text-muted-foreground">
                {pendingCount} à synchroniser
              </span>
            </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
});
