import { makeAutoObservable } from 'mobx';
import { Store } from '../standard/base';
import { db, type ConflictItem } from '@/lib/db';
import { eventBus } from '@/lib/event';

/**
 * Store for managing sync conflicts between local and server data.
 */
export class ConflictStore implements Store {
  sid = 'ConflictStore';

  /** List of unresolved conflicts */
  conflicts: ConflictItem[] = [];

  /** Count of unresolved conflicts */
  get unresolvedCount(): number {
    return this.conflicts.filter(c => !c.resolved).length;
  }

  constructor() {
    makeAutoObservable(this);
    this.loadConflicts();
  }

  /**
   * Load all unresolved conflicts from IndexedDB
   */
  async loadConflicts() {
    const conflicts = await db.conflicts
      .where('resolved')
      .equals(false)
      .sortBy('timestamp');

    this.conflicts = conflicts;
  }

  /**
   * Detect if there's a conflict between local and server versions
   */
  async detectConflict(params: {
    entityType: string;
    entityId: number;
    localData: any;
    serverData: any;
    lastSyncTime: number;
  }): Promise<boolean> {
    const { entityType, entityId, localData, serverData, lastSyncTime } = params;

    // Check if both local and server were modified after last sync
    const localModified = localData.localUpdatedAt > lastSyncTime;
    const serverModified = new Date(serverData.updatedAt).getTime() > lastSyncTime;

    if (localModified && serverModified) {
      // CONFLICT: Both sides modified
      const conflict: ConflictItem = {
        entityType,
        entityId,
        localVersion: localData.localUpdatedAt,
        serverVersion: new Date(serverData.updatedAt).getTime(),
        localData,
        serverData,
        timestamp: Date.now(),
        resolved: false
      };

      await db.conflicts.add(conflict);
      await this.loadConflicts();

      eventBus.emit('conflict:detected', conflict);
      return true;
    }

    return false;
  }

  /**
   * Resolve a conflict with one of three strategies:
   * - 'local': Keep local version
   * - 'server': Keep server version
   * - 'merge': Attempt to merge (for text content)
   */
  async resolveConflict(conflictId: number, strategy: 'local' | 'server' | 'merge', mergedData?: any) {
    const conflict = await db.conflicts.get(conflictId);
    if (!conflict) return;

    try {
      if (strategy === 'local') {
        // Keep local: mark for sync to server
        const { SyncQueueStore } = await import('./syncQueueStore');
        const { RootStore } = await import('../root');

        await RootStore.Get(SyncQueueStore).enqueue({
          operationType: 'update',
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          data: conflict.localData,
          status: 'pending'
        });

        // Update local note to keep it
        await db.notes.update(conflict.entityId, {
          syncStatus: 'pending' as const
        });

      } else if (strategy === 'server') {
        // Keep server: overwrite local
        await db.notes.put({
          ...conflict.serverData,
          localUpdatedAt: Date.now(),
          syncStatus: 'synced' as const
        });

      } else if (strategy === 'merge' && mergedData) {
        // Use merged data
        await db.notes.put({
          ...mergedData,
          localUpdatedAt: Date.now(),
          syncStatus: 'pending' as const
        });

        // Queue for sync
        const { SyncQueueStore } = await import('./syncQueueStore');
        const { RootStore } = await import('../root');

        await RootStore.Get(SyncQueueStore).enqueue({
          operationType: 'update',
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          data: mergedData,
          status: 'pending'
        });
      }

      // Mark conflict as resolved
      await db.conflicts.update(conflictId, { resolved: true });
      await this.loadConflicts();

      eventBus.emit('conflict:resolved', conflictId);

    } catch (error) {
      console.error('Failed to resolve conflict:', error);
      throw error;
    }
  }

  /**
   * Merge text content using simple line-based merge
   * For more complex merging, could integrate diff-match-patch
   */
  mergeContent(baseContent: string, localContent: string, serverContent: string): string {
    // Simple merge: if same, return it; if different, concatenate with markers
    if (localContent === serverContent) {
      return localContent;
    }

    // If content differs, add conflict markers
    return `<<<<<<< LOCAL\n${localContent}\n=======\n${serverContent}\n>>>>>>> SERVER`;
  }

  /**
   * Dismiss/ignore a conflict (mark as resolved without action)
   */
  async dismissConflict(conflictId: number) {
    await db.conflicts.update(conflictId, { resolved: true });
    await this.loadConflicts();
  }

  /**
   * Clear all resolved conflicts older than 30 days
   */
  async cleanupOldConflicts() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const oldResolved = await db.conflicts
      .where('resolved')
      .equals(true)
      .and(c => c.timestamp < thirtyDaysAgo)
      .toArray();

    for (const conflict of oldResolved) {
      if (conflict.id) {
        await db.conflicts.delete(conflict.id);
      }
    }
  }
}
