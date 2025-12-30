import { observer } from 'mobx-react-lite';
import { RootStore } from '@/store';
import { BaseStore } from '@/store/baseStore';
import { SyncQueueStore } from '@/store/sync/syncQueueStore';
import { Icon } from '@/components/Common/Iconify/icons';
import { useTranslation } from 'react-i18next';

/**
 * Displays current online/offline and sync status
 */
export const SyncIndicator = observer(() => {
  const base = RootStore.Get(BaseStore);
  const syncQueue = RootStore.Get(SyncQueueStore);
  const { t } = useTranslation();

  const isOnline = base.isOnline;
  const pendingCount = syncQueue.queueLength;
  const failedCount = syncQueue.failedCount;

  // Determine status color and icon
  let statusColor = 'text-green-500';
  let statusIcon = 'solar:wi-fi-bold';
  let statusText = 'Online';

  if (!isOnline) {
    statusColor = 'text-red-500';
    statusIcon = 'solar:wi-fi-off-bold';
    statusText = 'Offline';
  } else if (failedCount > 0) {
    statusColor = 'text-orange-500';
    statusIcon = 'solar:cloud-cross-bold';
    statusText = `Sync Error (${failedCount})`;
  } else if (pendingCount > 0) {
    statusColor = 'text-yellow-500';
    statusIcon = 'solar:cloud-upload-bold';
    statusText = `Syncing (${pendingCount})`;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-background/50">
      <Icon
        icon={statusIcon}
        className={`${statusColor} text-lg`}
      />
      <span className={`text-sm ${statusColor} font-medium`}>
        {statusText}
      </span>
      {pendingCount > 0 && (
        <div className="ml-1 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs">
          {pendingCount} pending
        </div>
      )}
    </div>
  );
});
