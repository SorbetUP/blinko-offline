import { makeAutoObservable } from 'mobx';
import { Store } from '../standard/base';
import { db, type SyncQueueItem, type SyncOperationType, type SyncQueueStatus } from '@/lib/db';

export class SyncQueueStore implements Store {
  sid = 'SyncQueueStore';
  queueLength: number = 0;
  failedCount: number = 0;
  pendingCount: number = 0;
  isProcessing: boolean = false;

  constructor() {
    makeAutoObservable(this);
    this.loadQueueStats();
  }

  beginProcessing() {
    if (this.isProcessing) return false;
    this.isProcessing = true;
    return true;
  }

  endProcessing() {
    this.isProcessing = false;
  }

  async loadQueueStats() {
    const failedStatus: SyncQueueStatus = 'failed';
    const queueLength = await db.syncQueue.count();
    const failedCount = await db.syncQueue.where('status').equals(failedStatus).count();
    const pendingCount = await db.syncQueue.where('status').equals('pending').count();

    this.queueLength = queueLength;
    this.failedCount = failedCount;
    this.pendingCount = pendingCount;
  }

  async enqueue(operation: Omit<SyncQueueItem, 'id' | 'timestamp' | 'retryCount'>) {
    const operationType: SyncOperationType = operation.operationType;
    const item: SyncQueueItem = {
      ...operation,
      operationType,
      timestamp: Date.now(),
      retryCount: 0,
    };

    await db.syncQueue.add(item);
    await this.loadQueueStats();
  }

  async processQueue() {
    const pending = await db.syncQueue
      .where('status')
      .equals('pending')
      .sortBy('timestamp');

    for (const op of pending) {
      await this.processOperation(op);
    }
  }

  async processOperation(op: SyncQueueItem) {
    try {
      await db.syncQueue.update(op.id!, { status: 'in_progress' });
      // Note: The actual processing logic is handled in blinkoStore.syncOfflineNotes()
      // This is just a placeholder for retry logic
      await db.syncQueue.delete(op.id!);
    } catch (error) {
      const newRetryCount = (op.retryCount || 0) + 1;
      if (newRetryCount >= 5) {
        // Max retries reached
        await db.syncQueue.update(op.id!, {
          status: 'failed',
          retryCount: newRetryCount
        });
      } else {
        // Schedule retry with exponential backoff
        const backoff = Math.min(Math.pow(2, newRetryCount) * 1000, 30000);
        await db.syncQueue.update(op.id!, {
          status: 'pending',
          retryCount: newRetryCount
        });
        setTimeout(() => this.processOperation(op), backoff);
      }
    }
  }

  async deduplicateQueue() {
    // Get all pending operations
    const operations = await db.syncQueue
      .where('status')
      .equals('pending')
      .toArray();

    // Group by entityType + entityId
    const grouped = new Map<string, SyncQueueItem[]>();
    for (const op of operations) {
      const key = `${op.entityType}:${op.entityId}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(op);
    }

    // Keep only the latest operation for each entity
    for (const [key, ops] of grouped) {
      if (ops.length > 1) {
        // Sort by timestamp descending
        ops.sort((a, b) => b.timestamp - a.timestamp);
        // Keep the first (latest), delete the rest
        for (let i = 1; i < ops.length; i++) {
          await db.syncQueue.delete(ops[i].id!);
        }
      }
    }

    await this.loadQueueStats();
  }

  async retryFailed() {
    const failed = await db.syncQueue
      .where('status')
      .equals('failed')
      .toArray();

    for (const op of failed) {
      if (op.retryCount < 5) {
        await db.syncQueue.update(op.id!, { status: 'pending', retryCount: 0 });
      }
    }

    await this.loadQueueStats();
    await this.processQueue();
  }
}
