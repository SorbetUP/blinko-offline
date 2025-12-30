#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Setup fake IndexedDB for Node.js environment
import {
  indexedDB,
  IDBKeyRange,
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent
} from 'fake-indexeddb';
import { Dexie } from 'dexie';

// Setup all IndexedDB globals
(globalThis as any).indexedDB = indexedDB;
(globalThis as any).IDBKeyRange = IDBKeyRange;
(globalThis as any).IDBCursor = IDBCursor;
(globalThis as any).IDBCursorWithValue = IDBCursorWithValue;
(globalThis as any).IDBDatabase = IDBDatabase;
(globalThis as any).IDBFactory = IDBFactory;
(globalThis as any).IDBIndex = IDBIndex;
(globalThis as any).IDBObjectStore = IDBObjectStore;
(globalThis as any).IDBOpenDBRequest = IDBOpenDBRequest;
(globalThis as any).IDBRequest = IDBRequest;
(globalThis as any).IDBTransaction = IDBTransaction;
(globalThis as any).IDBVersionChangeEvent = IDBVersionChangeEvent;

// Configuration
const BLINKO_BASE_URL = process.env.BLINKO_BASE_URL || 'http://localhost:1111';
const BLINKO_TOKEN = process.env.BLINKO_TOKEN || '';

// IndexedDB Schema (copied from app/src/lib/db/index.ts)
export interface DBNote {
  id: number;
  content: string;
  type: number;
  isArchived: boolean;
  isTop: boolean;
  isShare: boolean;
  isRecycle: boolean;
  createdAt: string;
  updatedAt: string;
  accountId: number;
  localUpdatedAt: number;
  syncStatus: 'synced' | 'pending' | 'conflict';
}

export interface DBAttachment {
  id: number;
  noteId: number | null;
  name: string;
  path: string;
  size: number;
  type: string;
  blob?: Blob;
  lastAccessed?: number;
  accessCount?: number;
  syncStatus: 'synced' | 'pending';
}

export interface SyncOperation {
  id?: number;
  entityType: 'note' | 'attachment';
  entityId: number;
  operationType: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  status: 'pending' | 'in_progress' | 'failed';
  retryCount?: number;
}

export interface SyncMetadata {
  key: string;
  value: any;
}

class BlinkoOfflineDB extends Dexie {
  notes!: Dexie.Table<DBNote, number>;
  attachments!: Dexie.Table<DBAttachment, number>;
  syncQueue!: Dexie.Table<SyncOperation, number>;
  syncMetadata!: Dexie.Table<SyncMetadata, string>;

  constructor() {
    super('BlinkoOfflineDB');

    this.version(1).stores({
      notes: 'id, accountId, isArchived, isTop, isRecycle, createdAt, updatedAt, localUpdatedAt, syncStatus',
      attachments: 'id, noteId, syncStatus, lastAccessed',
      syncQueue: '++id, entityType, entityId, status, timestamp',
      syncMetadata: 'key'
    });
  }
}

const db = new BlinkoOfflineDB();

// Simple tRPC client
async function callTRPC(procedure: string, input: any) {
  const response = await fetch(`${BLINKO_BASE_URL}/api/trpc/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(BLINKO_TOKEN && { 'Authorization': `Bearer ${BLINKO_TOKEN}` })
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data: any = await response.json();
  return data.result?.data?.json || data.result?.data;
}

// Sync state
let isOnline = true;
let isSyncing = false;
let lastSyncTime: number | null = null;

// Sync functions
async function pushChanges() {
  if (isSyncing) return;

  try {
    isSyncing = true;

    const pendingOps = await db.syncQueue
      .where('status')
      .equals('pending')
      .sortBy('timestamp');

    console.error(`[Sync] Pushing ${pendingOps.length} operations...`);

    for (const op of pendingOps) {
      try {
        await db.syncQueue.update(op.id!, { status: 'in_progress' });

        if (op.entityType === 'note') {
          const noteData = op.data as any;

          if (op.operationType === 'create') {
            const result = await callTRPC('notes.upsert', {
              content: noteData.content,
              type: noteData.type,
              isArchived: noteData.isArchived,
              isTop: noteData.isTop
            });

            // Replace local note with server note
            await db.notes.delete(noteData.id);
            await db.notes.put({
              ...result,
              localUpdatedAt: Date.now(),
              syncStatus: 'synced' as const
            });

          } else if (op.operationType === 'update') {
            const result = await callTRPC('notes.upsert', {
              id: noteData.id,
              content: noteData.content,
              type: noteData.type,
              isArchived: noteData.isArchived,
              isTop: noteData.isTop
            });

            await db.notes.update(noteData.id, {
              ...result,
              localUpdatedAt: Date.now(),
              syncStatus: 'synced' as const
            });

          } else if (op.operationType === 'delete') {
            await callTRPC('notes.delete', { id: noteData.id });
            await db.notes.delete(noteData.id);
          }
        }

        await db.syncQueue.delete(op.id!);

      } catch (error: any) {
        console.error(`[Sync] Operation failed:`, error.message);
        const newRetryCount = (op.retryCount || 0) + 1;

        if (newRetryCount >= 5) {
          await db.syncQueue.update(op.id!, {
            status: 'failed',
            retryCount: newRetryCount
          });
        } else {
          await db.syncQueue.update(op.id!, {
            status: 'pending',
            retryCount: newRetryCount
          });
        }
      }
    }

  } finally {
    isSyncing = false;
  }
}

async function pullChanges() {
  if (isSyncing) return;

  try {
    isSyncing = true;

    const metadata = await db.syncMetadata.get('lastSyncTime');
    const since = metadata?.value || 0;

    console.error(`[Sync] Pulling changes since ${new Date(since).toISOString()}...`);

    const serverNotes = await callTRPC('notes.listSince', {
      since: new Date(since).toISOString(),
      page: 1,
      size: 1000
    });

    for (const serverNote of serverNotes.list || []) {
      const localNote = await db.notes.get(serverNote.id);

      if (localNote && localNote.syncStatus === 'pending') {
        // Conflict: check timestamps
        const serverTimestamp = new Date(serverNote.updatedAt).getTime();
        const localTimestamp = localNote.localUpdatedAt;

        if (localTimestamp > serverTimestamp) {
          console.error(`[Sync] Conflict: keeping local version for note ${serverNote.id}`);
          continue;
        } else {
          console.error(`[Sync] Conflict: using server version for note ${serverNote.id}`);
        }
      }

      await db.notes.put({
        ...serverNote,
        localUpdatedAt: Date.now(),
        syncStatus: 'synced' as const
      });
    }

    lastSyncTime = Date.now();
    await db.syncMetadata.put({ key: 'lastSyncTime', value: lastSyncTime });

  } finally {
    isSyncing = false;
  }
}

async function sync() {
  if (!isOnline) {
    console.error('[Sync] Cannot sync: offline');
    return;
  }

  console.error('[Sync] Starting bidirectional sync...');

  try {
    await pushChanges();
    await pullChanges();
    console.error('[Sync] Sync completed successfully');
  } catch (error: any) {
    console.error('[Sync] Sync failed:', error.message);
    throw error;
  }
}

// Periodic sync (every 5 minutes)
setInterval(async () => {
  if (isOnline && !isSyncing) {
    try {
      await sync();
    } catch (error) {
      console.error('[Sync] Periodic sync failed');
    }
  }
}, 5 * 60 * 1000);

// Create MCP server
const server = new Server(
  {
    name: 'blinko-offline-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'create_note',
        description: 'Create a new note (works offline, will sync when online)',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content of the note (supports markdown)'
            },
            isArchived: {
              type: 'boolean',
              description: 'Whether the note should be archived',
              default: false
            },
            isTop: {
              type: 'boolean',
              description: 'Pin the note to top',
              default: false
            }
          },
          required: ['content']
        }
      },
      {
        name: 'list_notes',
        description: 'List all local notes (works offline)',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of notes to return',
              default: 20
            },
            isArchived: {
              type: 'boolean',
              description: 'Filter by archived status'
            }
          }
        }
      },
      {
        name: 'search_notes',
        description: 'Search notes by content (works offline on local cache)',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'update_note',
        description: 'Update an existing note (works offline)',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: 'The ID of the note to update'
            },
            content: {
              type: 'string',
              description: 'The new content for the note'
            }
          },
          required: ['id', 'content']
        }
      },
      {
        name: 'delete_note',
        description: 'Delete a note (works offline)',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: 'The ID of the note to delete'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'sync_now',
        description: 'Manually trigger synchronization with server',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_sync_status',
        description: 'Get current sync status and pending operations',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'set_offline_mode',
        description: 'Manually set online/offline mode',
        inputSchema: {
          type: 'object',
          properties: {
            offline: {
              type: 'boolean',
              description: 'Set to true for offline mode, false for online'
            }
          },
          required: ['offline']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error('Missing arguments');
  }

  try {
    switch (name) {
      case 'create_note': {
        const tempId = -Date.now(); // Temporary negative ID for offline notes

        const newNote: DBNote = {
          id: tempId,
          content: args.content as string,
          type: 0,
          isArchived: (args.isArchived as boolean) || false,
          isTop: (args.isTop as boolean) || false,
          isShare: false,
          isRecycle: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          accountId: 1,
          localUpdatedAt: Date.now(),
          syncStatus: 'pending' as const
        };

        await db.notes.add(newNote);

        // Add to sync queue
        await db.syncQueue.add({
          entityType: 'note',
          entityId: tempId,
          operationType: 'create',
          data: newNote,
          timestamp: Date.now(),
          status: 'pending'
        });

        // Try to sync if online
        if (isOnline) {
          sync().catch(err => console.error('[Sync] Auto-sync failed:', err));
        }

        return {
          content: [
            {
              type: 'text',
              text: `Note created ${isOnline ? '(syncing...)' : '(offline - will sync later)'}\n${JSON.stringify(newNote, null, 2)}`
            }
          ]
        };
      }

      case 'list_notes': {
        let query = db.notes.orderBy('createdAt').reverse();

        if (args.isArchived !== undefined) {
          query = query.filter(n => n.isArchived === args.isArchived);
        }

        const notes = await query.limit(args.limit as number || 20).toArray();

        return {
          content: [
            {
              type: 'text',
              text: `Found ${notes.length} notes (${isOnline ? 'online' : 'offline'}):\n${JSON.stringify(notes, null, 2)}`
            }
          ]
        };
      }

      case 'search_notes': {
        const query = (args.query as string).toLowerCase();
        const notes = await db.notes
          .filter(n => n.content.toLowerCase().includes(query))
          .toArray();

        return {
          content: [
            {
              type: 'text',
              text: `Found ${notes.length} notes matching "${args.query}":\n${JSON.stringify(notes, null, 2)}`
            }
          ]
        };
      }

      case 'update_note': {
        const note = await db.notes.get(args.id as number);
        if (!note) {
          throw new Error(`Note ${args.id} not found`);
        }

        await db.notes.update(args.id as number, {
          content: args.content as string,
          updatedAt: new Date().toISOString(),
          localUpdatedAt: Date.now(),
          syncStatus: 'pending' as const
        });

        // Add to sync queue
        await db.syncQueue.add({
          entityType: 'note',
          entityId: args.id as number,
          operationType: 'update',
          data: { ...note, content: args.content },
          timestamp: Date.now(),
          status: 'pending'
        });

        if (isOnline) {
          sync().catch(err => console.error('[Sync] Auto-sync failed:', err));
        }

        return {
          content: [
            {
              type: 'text',
              text: `Note ${args.id} updated ${isOnline ? '(syncing...)' : '(offline - will sync later)'}`
            }
          ]
        };
      }

      case 'delete_note': {
        const note = await db.notes.get(args.id as number);
        if (!note) {
          throw new Error(`Note ${args.id} not found`);
        }

        await db.notes.delete(args.id as number);

        // Add to sync queue
        await db.syncQueue.add({
          entityType: 'note',
          entityId: args.id as number,
          operationType: 'delete',
          data: note,
          timestamp: Date.now(),
          status: 'pending'
        });

        if (isOnline) {
          sync().catch(err => console.error('[Sync] Auto-sync failed:', err));
        }

        return {
          content: [
            {
              type: 'text',
              text: `Note ${args.id} deleted ${isOnline ? '(syncing...)' : '(offline - will sync later)'}`
            }
          ]
        };
      }

      case 'sync_now': {
        if (!isOnline) {
          return {
            content: [
              {
                type: 'text',
                text: 'Cannot sync: offline mode enabled'
              }
            ]
          };
        }

        await sync();

        return {
          content: [
            {
              type: 'text',
              text: `Sync completed successfully at ${new Date().toISOString()}`
            }
          ]
        };
      }

      case 'get_sync_status': {
        const pendingOps = await db.syncQueue.where('status').equals('pending').count();
        const failedOps = await db.syncQueue.where('status').equals('failed').count();
        const totalNotes = await db.notes.count();
        const pendingNotes = await db.notes.where('syncStatus').equals('pending').count();

        const status = {
          online: isOnline,
          syncing: isSyncing,
          lastSyncTime: lastSyncTime ? new Date(lastSyncTime).toISOString() : 'never',
          pendingOperations: pendingOps,
          failedOperations: failedOps,
          totalNotes,
          pendingNotes
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2)
            }
          ]
        };
      }

      case 'set_offline_mode': {
        isOnline = !(args.offline as boolean);

        return {
          content: [
            {
              type: 'text',
              text: `Mode set to: ${isOnline ? 'ONLINE' : 'OFFLINE'}`
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}\n${error.stack}`
        }
      ],
      isError: true
    };
  }
});

// Start server
async function main() {
  console.error('Blinko Offline MCP Server starting...');
  console.error(`Base URL: ${BLINKO_BASE_URL}`);
  console.error(`Token: ${BLINKO_TOKEN ? '***' : '(none)'}`);

  // Initialize database
  await db.open();
  console.error('IndexedDB initialized');

  // Initial sync if online
  if (isOnline) {
    console.error('Performing initial sync...');
    try {
      await sync();
      console.error('Initial sync completed');
    } catch (error: any) {
      console.error('Initial sync failed:', error.message);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Blinko MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
