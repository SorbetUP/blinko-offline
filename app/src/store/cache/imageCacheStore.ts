import { makeAutoObservable } from 'mobx';
import { Store } from '../standard/base';
import { db } from '@/lib/db';

/**
 * LRU (Least Recently Used) cache for image attachments.
 * Stores image blobs in IndexedDB with access tracking for intelligent eviction.
 */
export class ImageCacheStore implements Store {
  sid = 'ImageCacheStore';

  /** Maximum cache size in bytes (default: 100MB) */
  maxSize: number = 100 * 1024 * 1024;

  /** Current cache size in bytes */
  currentSize: number = 0;

  /** Number of cached images */
  cachedImageCount: number = 0;

  constructor() {
    makeAutoObservable(this);
    this.calculateCacheSize();
  }

  /**
   * Calculate current cache size and update observables
   */
  async calculateCacheSize() {
    const cachedAttachments = await db.attachments
      .where('blob')
      .notEqual(undefined)
      .toArray();

    let totalSize = 0;
    for (const attachment of cachedAttachments) {
      if (attachment.blob) {
        totalSize += attachment.blob.size;
      }
    }

    this.currentSize = totalSize;
    this.cachedImageCount = cachedAttachments.length;
  }

  /**
   * Cache an image blob for offline access
   */
  async cacheImage(attachmentId: number, blob: Blob) {
    try {
      // Check if we need to free space
      const newSize = this.currentSize + blob.size;
      if (newSize > this.maxSize) {
        await this.evictLRU(blob.size);
      }

      // Get existing attachment metadata or create new
      let attachment = await db.attachments.get(attachmentId);

      if (attachment) {
        // Update existing
        await db.attachments.update(attachmentId, {
          blob,
          lastAccessed: Date.now(),
          accessCount: (attachment.accessCount || 0) + 1
        });
      } else {
        // Create new (shouldn't happen normally, but handle it)
        await db.attachments.add({
          id: attachmentId,
          noteId: null,
          name: '',
          path: '',
          size: blob.size,
          type: blob.type,
          blob,
          lastAccessed: Date.now(),
          accessCount: 1,
          syncStatus: 'synced'
        });
      }

      await this.calculateCacheSize();

    } catch (error) {
      console.error('Failed to cache image:', error);
      throw error;
    }
  }

  /**
   * Retrieve a cached image blob
   */
  async getImage(attachmentId: number): Promise<Blob | null> {
    try {
      const attachment = await db.attachments.get(attachmentId);

      if (attachment?.blob) {
        // Update access stats
        await db.attachments.update(attachmentId, {
          lastAccessed: Date.now(),
          accessCount: (attachment.accessCount || 0) + 1
        });

        return attachment.blob;
      }

      return null;

    } catch (error) {
      console.error('Failed to get cached image:', error);
      return null;
    }
  }

  /**
   * Evict least recently used images to free up space
   */
  async evictLRU(spaceNeeded: number = 0) {
    try {
      // Get all cached images sorted by last accessed (oldest first)
      const cachedImages = await db.attachments
        .where('blob')
        .notEqual(undefined)
        .sortBy('lastAccessed');

      let freedSpace = 0;
      const targetSpace = spaceNeeded || (this.maxSize * 0.2); // Free 20% if not specified

      for (const image of cachedImages) {
        if (freedSpace >= targetSpace) break;

        if (image.blob && image.id) {
          // Remove blob but keep metadata
          await db.attachments.update(image.id, {
            blob: undefined
          });

          freedSpace += image.blob.size;
        }
      }

      await this.calculateCacheSize();

      console.log(`Evicted ${freedSpace / 1024 / 1024}MB from cache`);

    } catch (error) {
      console.error('Failed to evict LRU:', error);
    }
  }

  /**
   * Manually prune cache to stay under size limit
   */
  async pruneCache() {
    if (this.currentSize > this.maxSize) {
      const excess = this.currentSize - this.maxSize;
      await this.evictLRU(excess);
    }
  }

  /**
   * Clear all cached images (keep metadata)
   */
  async clearCache() {
    try {
      const cachedImages = await db.attachments
        .where('blob')
        .notEqual(undefined)
        .toArray();

      for (const image of cachedImages) {
        if (image.id) {
          await db.attachments.update(image.id, {
            blob: undefined
          });
        }
      }

      await this.calculateCacheSize();

    } catch (error) {
      console.error('Failed to clear cache:', error);
      throw error;
    }
  }

  /**
   * Update max cache size setting
   */
  setMaxSize(newSize: number) {
    this.maxSize = newSize;

    // Prune if current size exceeds new limit
    if (this.currentSize > newSize) {
      this.pruneCache();
    }
  }

  /**
   * Get cache usage percentage
   */
  get usagePercentage(): number {
    if (this.maxSize === 0) return 0;
    return (this.currentSize / this.maxSize) * 100;
  }

  /**
   * Format bytes to human readable string
   */
  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}
