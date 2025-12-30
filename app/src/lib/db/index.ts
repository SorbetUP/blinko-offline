import Dexie, { Table } from 'dexie';
import type { Note } from '@shared/lib/types';

/**
 * Sync status stored for local entities.
 */
export type SyncStatus = 'pending' | 'synced' | 'failed' | 'conflict';

/**
 * Queue operation type for outbound sync.
 */
export type SyncOperationType = 'create' | 'update' | 'delete';

/**
 * Processing status for the sync queue.
 */
export type SyncQueueStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Local note entity extending the server note model.
 */
export interface DBNote extends Note {
  /**
   * Local modification timestamp (epoch ms).
   */
  localUpdatedAt: number;
  /**
   * Sync status for this note.
   */
  syncStatus: SyncStatus;
}

/**
 * Local attachment entity stored with notes.
 */
export interface DBAttachment {
  id: number;
  noteId: number | null;
  name: string;
  path: string;
  size: number;
  type: string;
  /**
   * Optional binary payload when cached locally.
   */
  blob?: Blob;
  /**
   * Last access timestamp (epoch ms).
   */
  lastAccessed: number;
  /**
   * Number of local reads for caching heuristics.
   */
  accessCount: number;
  /**
   * Sync status for this attachment.
   */
  syncStatus: SyncStatus;
}

/**
 * Outbound sync queue item.
 */
export interface SyncQueueItem {
  id?: number;
  operationType: SyncOperationType;
  entityType: string;
  entityId: number;
  data: unknown;
  timestamp: number;
  retryCount: number;
  status: SyncQueueStatus;
}

/**
 * Metadata for sync bookkeeping.
 */
export interface SyncMetadata {
  key: string;
  lastSyncTime: number;
  serverVersion?: string | number;
  metadata?: Record<string, unknown>;
}

/**
 * Captures local/server divergence for manual resolution.
 */
export interface ConflictItem {
  id?: number;
  entityType: string;
  entityId: number;
  localVersion: string | number;
  serverVersion: string | number;
  localData: unknown;
  serverData: unknown;
  timestamp: number;
  resolved: boolean;
}

/**
 * Dexie database for Blinko offline storage.
 */
export class BlinkoDatabase extends Dexie {
  notes!: Table<DBNote, number>;
  attachments!: Table<DBAttachment, number>;
  syncQueue!: Table<SyncQueueItem, number>;
  syncMetadata!: Table<SyncMetadata, string>;
  conflicts!: Table<ConflictItem, number>;

  constructor() {
    super('BlinkoDatabase');

    this.version(1).stores({
      notes: 'id, accountId, createdAt, updatedAt, localUpdatedAt, isArchived, isRecycle, type, syncStatus',
      attachments: 'id, noteId, lastAccessed, accessCount, syncStatus',
      syncQueue: '++id, timestamp, status, entityId, entityType',
      syncMetadata: 'key',
      conflicts: '++id, resolved, timestamp, entityType, entityId',
    });
  }
}

/**
 * Shared singleton instance for the app.
 */
export const db = new BlinkoDatabase();
