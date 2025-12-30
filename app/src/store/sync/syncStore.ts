import { makeAutoObservable } from 'mobx';
import { Store } from '../standard/base';
import { db, type SyncMetadata } from '@/lib/db';
import { eventBus } from '@/lib/event';

export class SyncStore implements Store {
  sid = 'SyncStore';
  isSyncing: boolean = false;
  lastSyncTime: number | null = null;
  pendingCount: number = 0;
  syncProgress: number = 0;
  syncIntervalId: NodeJS.Timeout | null = null;
  syncIntervalMs: number = 5 * 60 * 1000; // 5 minutes

  constructor() {
    makeAutoObservable(this);
    this.loadSyncMetadata();
    this.startPeriodicSync();
  }

  private normalizeReferenceIds(references: unknown) {
    if (!Array.isArray(references)) {
      return references === undefined ? undefined : [];
    }
    return references
      .map((ref) => (typeof ref === 'number' ? ref : (ref as { toNoteId?: number }).toNoteId))
      .filter((refId): refId is number => typeof refId === 'number');
  }

  async loadSyncMetadata() {
    const metadata: SyncMetadata | undefined = await db.syncMetadata.get('lastSync');
    this.lastSyncTime = metadata?.lastSyncTime ?? null;
  }

  async sync() {
    this.isSyncing = true;
    eventBus.emit('sync:start');

    try {
      await this.pullChanges();
      await this.pushChanges();
      eventBus.emit('sync:complete');
    } catch (error) {
      eventBus.emit('sync:error', error);
    } finally {
      this.isSyncing = false;
    }
  }

  async pullChanges() {
    // Get last sync time
    const lastSync = this.lastSyncTime || 0;

    try {
      const { api } = await import('@/lib/trpc');
      const { ConflictStore } = await import('./conflictStore');
      const { RootStore } = await import('../root');
      const conflictStore = RootStore.Get(ConflictStore);

      // Fetch changes from server since last sync
      const serverChanges = await api.notes.listSince.query({
        since: new Date(lastSync)
      });

      // Process each server change
      for (const serverNote of serverChanges) {
        const localNote = await db.notes.get(serverNote.id);

        if (localNote && localNote.syncStatus === 'pending') {
          // Conflict detected: both local and server modified
          // Strategy: Take the LATEST modification (compare timestamps)
          const serverTimestamp = new Date(serverNote.updatedAt).getTime();
          const localTimestamp = localNote.localUpdatedAt;

          if (localTimestamp > serverTimestamp) {
            // Local is newer: keep local version and queue for push
            // (Already in sync queue, just log it)
            console.log(`Conflict resolved: keeping local version for note ${serverNote.id} (local: ${new Date(localTimestamp).toISOString()}, server: ${new Date(serverTimestamp).toISOString()})`);
          } else {
            // Server is newer or equal: use server version
            console.log(`Conflict resolved: using server version for note ${serverNote.id} (local: ${new Date(localTimestamp).toISOString()}, server: ${new Date(serverTimestamp).toISOString()})`);
            await db.notes.put({
              ...serverNote,
              localUpdatedAt: Date.now(),
              syncStatus: 'synced' as const
            });
            // Remove from sync queue since we're taking server version
            await db.syncQueue.where('entityId').equals(serverNote.id).delete();
          }
        } else if (!localNote) {
          // New note from server: add to local
          await db.notes.put({
            ...serverNote,
            localUpdatedAt: Date.now(),
            syncStatus: 'synced' as const
          });
        } else {
          // Local note exists and is synced: update with server version
          await db.notes.put({
            ...serverNote,
            localUpdatedAt: Date.now(),
            syncStatus: 'synced' as const
          });
        }
      }

      // Update last sync time
      await this.updateLastSyncTime();

    } catch (error) {
      console.error('PULL sync failed:', error);
      throw error;
    }
  }

  async pushChanges() {
    try {
      const { api } = await import('@/lib/trpc');
      const { SyncQueueStore } = await import('./syncQueueStore');
      const { RootStore } = await import('../root');
      const syncQueueStore = RootStore.Get(SyncQueueStore);
      if (!syncQueueStore.beginProcessing()) {
        return;
      }

      try {
        // Get all pending operations from queue
        const pendingOps = await db.syncQueue
          .where('status')
          .equals('pending')
          .sortBy('timestamp');

        this.pendingCount = pendingOps.length;
        let processedCount = 0;

        for (const op of pendingOps) {
          try {
            // Update status to in_progress
            await db.syncQueue.update(op.id!, { status: 'in_progress' });

            if (op.entityType === 'note') {
              const noteData = op.data as any;
              const referenceIds = this.normalizeReferenceIds(noteData.references);

              if (op.operationType === 'create') {
                // CREATE: Send to server and get real ID
                const result = await api.notes.upsert.mutate({
                  id: undefined, // Force create with new ID
                  content: noteData.content,
                  type: noteData.type,
                  isArchived: noteData.isArchived,
                  isTop: noteData.isTop,
                  isRecycle: noteData.isRecycle,
                  isShare: noteData.isShare,
                  attachments: noteData.attachments,
                  references: referenceIds,
                  metadata: noteData.metadata
                });

                // Delete temp local note and add with server ID
                await db.notes.delete(noteData.id);
                await db.notes.put({
                  ...result,
                  localUpdatedAt: Date.now(),
                  syncStatus: 'synced' as const
                });

              } else if (op.operationType === 'update') {
                // UPDATE: Send changes to server
                await api.notes.upsert.mutate({
                  id: noteData.id,
                  content: noteData.content,
                  type: noteData.type,
                  isArchived: noteData.isArchived,
                  isTop: noteData.isTop,
                  isRecycle: noteData.isRecycle,
                  isShare: noteData.isShare,
                  attachments: noteData.attachments,
                  references: referenceIds,
                  metadata: noteData.metadata
                });

                // Mark as synced
                await db.notes.update(noteData.id, {
                  syncStatus: 'synced' as const
                });

              } else if (op.operationType === 'delete') {
                // DELETE: Remove from server (via isRecycle or hard delete)
                await api.notes.trashMany.mutate({ ids: [noteData.id] });
                await db.notes.delete(noteData.id);
              }
            }

            // Mark operation as completed and remove from queue
            await db.syncQueue.delete(op.id!);

            processedCount++;
            this.syncProgress = (processedCount / this.pendingCount) * 100;

          } catch (error) {
            console.error(`Failed to sync operation ${op.id}:`, error);

            // Update retry count
            const newRetryCount = (op.retryCount || 0) + 1;
            if (newRetryCount >= 5) {
              // Max retries reached - mark as failed
              await db.syncQueue.update(op.id!, {
                status: 'failed',
                retryCount: newRetryCount
              });
            } else {
              // Reset to pending for retry
              await db.syncQueue.update(op.id!, {
                status: 'pending',
                retryCount: newRetryCount
              });
            }
          }
        }

        // Update queue stats
        await syncQueueStore.loadQueueStats();
      } finally {
        syncQueueStore.endProcessing();
      }

    } catch (error) {
      console.error('PUSH sync failed:', error);
      throw error;
    }
  }

  async updateLastSyncTime() {
    const metadata: SyncMetadata = {
      key: 'lastSync',
      lastSyncTime: Date.now(),
    };

    await db.syncMetadata.put(metadata);
    this.lastSyncTime = metadata.lastSyncTime;
  }

  /**
   * Start periodic sync every 5 minutes when online
   */
  startPeriodicSync() {
    // Clear any existing interval
    this.stopPeriodicSync();

    // Start new interval
    this.syncIntervalId = setInterval(async () => {
      const { BaseStore } = await import('../baseStore');
      const { RootStore } = await import('../root');
      const baseStore = RootStore.Get(BaseStore);

      // Only sync if online and not already syncing
      if (baseStore.isOnline && !this.isSyncing) {
        try {
          await this.sync();
        } catch (error) {
          console.error('Periodic sync failed:', error);
        }
      }
    }, this.syncIntervalMs);

    // Listen for online/offline events
    eventBus.on('online', this.handleOnline);
    eventBus.on('offline', this.handleOffline);
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    eventBus.off('online', this.handleOnline);
    eventBus.off('offline', this.handleOffline);
  }

  private handleOnline = async () => {
    // Trigger immediate sync when coming online
    if (!this.isSyncing) {
      try {
        await this.sync();
      } catch (error) {
        console.error('Auto-sync on reconnect failed:', error);
      }
    }
  };

  private handleOffline = () => {
    // Nothing to do when going offline - periodic sync will check online status
  };
}
