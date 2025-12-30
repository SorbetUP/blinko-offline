import { db } from './index';

/**
 * Migrates offline notes from localStorage to IndexedDB.
 * This is a one-time migration that runs on app initialization.
 */
export async function migrateOfflineNotes() {
  try {
    // Check if migration already done
    const migrationKey = 'offline_migration_completed';
    const migrated = localStorage.getItem(migrationKey);

    if (migrated === 'true') {
      console.log('Offline notes migration already completed');
      return;
    }

    // Get old offline notes from localStorage
    const oldOfflineNotesStr = localStorage.getItem('offlineNotes');

    if (!oldOfflineNotesStr) {
      console.log('No offline notes to migrate');
      localStorage.setItem(migrationKey, 'true');
      return;
    }

    let oldOfflineNotes: any[] = [];
    try {
      oldOfflineNotes = JSON.parse(oldOfflineNotesStr);
    } catch (e) {
      console.error('Failed to parse old offline notes:', e);
      localStorage.setItem(migrationKey, 'true');
      return;
    }

    if (!Array.isArray(oldOfflineNotes) || oldOfflineNotes.length === 0) {
      console.log('No valid offline notes to migrate');
      localStorage.setItem(migrationKey, 'true');
      return;
    }

    console.log(`Migrating ${oldOfflineNotes.length} offline notes to IndexedDB...`);

    // Migrate each note
    for (const oldNote of oldOfflineNotes) {
      try {
        // Convert old note format to new DBNote format
        const dbNote = {
          id: oldNote.id || Date.now(),
          content: oldNote.content || '',
          type: oldNote.type,
          isArchived: oldNote.isArchived || false,
          isRecycle: oldNote.isRecycle || false,
          attachments: oldNote.attachments || [],
          isTop: oldNote.isTop || false,
          isShare: oldNote.isShare || false,
          references: oldNote.references || [],
          createdAt: oldNote.createdAt ? new Date(oldNote.createdAt) : new Date(),
          updatedAt: oldNote.updatedAt ? new Date(oldNote.updatedAt) : new Date(),
          tags: oldNote.tags || [],
          metadata: oldNote.metadata || {},
          localUpdatedAt: Date.now(),
          syncStatus: 'pending' as const
        };

        // Add to IndexedDB
        await db.notes.put(dbNote);

        // Add to sync queue if pendingSync was true
        if (oldNote.pendingSync) {
          await db.syncQueue.add({
            operationType: 'create',
            entityType: 'note',
            entityId: dbNote.id,
            data: dbNote,
            timestamp: Date.now(),
            retryCount: 0,
            status: 'pending'
          });
        }

      } catch (error) {
        console.error('Failed to migrate note:', oldNote.id, error);
        // Continue with other notes even if one fails
      }
    }

    // Mark migration as complete
    localStorage.setItem(migrationKey, 'true');

    // Optionally remove old data (commented out for safety)
    // localStorage.removeItem('offlineNotes');

    console.log('Migration completed successfully');

  } catch (error) {
    console.error('Migration failed:', error);
  }
}

/**
 * Fixes notes in IndexedDB that are missing accountId
 * @param accountId The account ID to assign to notes without one
 */
export async function fixNotesWithoutAccountId(accountId: number) {
  try {
    const notesWithoutAccountId = await db.notes
      .filter(note => !note.accountId || note.accountId === null || note.accountId === undefined)
      .toArray();

    if (notesWithoutAccountId.length === 0) {
      console.log('[Migration] No notes without accountId found');
      return;
    }

    console.log(`[Migration] Fixing ${notesWithoutAccountId.length} notes without accountId...`);

    for (const note of notesWithoutAccountId) {
      try {
        await db.notes.update(note.id, { accountId });
      } catch (error) {
        console.error(`[Migration] Failed to fix note ${note.id}:`, error);
      }
    }

    console.log(`[Migration] Fixed ${notesWithoutAccountId.length} notes without accountId`);
  } catch (error) {
    console.error('[Migration] fixNotesWithoutAccountId failed:', error);
  }
}

/**
 * Initialize database and run migrations
 * @param accountId Optional account ID to fix notes without one
 */
export async function initializeDatabase(accountId?: number) {
  try {
    // Run migration from localStorage
    await migrateOfflineNotes();

    // Fix notes without accountId if accountId is provided
    if (accountId) {
      await fixNotesWithoutAccountId(accountId);
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
}
