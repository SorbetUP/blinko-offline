import type { Note } from '../lib/types';

export type PendingOp = { localId: number; op: 'create' | 'update'; note: Note; updatedAt: number };

export type LocalDbAdapter = {
  init: () => Promise<void>;
  getEffectiveUserId: (userId: unknown) => Promise<string>;
  setLastUserId: (userId: unknown) => Promise<string>;
  cacheUpsertServerNotes: (userId: unknown, serverNotes: Note[]) => Promise<void>;
  listCachedNotesLocal: (userId: unknown) => Promise<Note[]>;
  getCachedNoteLocal: (userId: unknown, localId: number) => Promise<Note | null>;
  cacheUpsertLocalNote: (userId: unknown, note: Note, serverId?: number | null) => Promise<void>;
  listPendingOps: (userId: unknown) => Promise<PendingOp[]>;
  upsertPendingOp: (userId: unknown, op: PendingOp['op'], note: Note) => Promise<void>;
  deletePendingOp: (userId: unknown, localId: number) => Promise<void>;
};

export type LocalBackendContext = {
  getUserId: () => unknown;
  db: LocalDbAdapter;
  now?: () => Date;
};
