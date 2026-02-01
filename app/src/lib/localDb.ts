import type { Note } from '@shared/lib/types';
import superjson from 'superjson';

type SqlRow = Record<string, unknown>;

const DB_URL = 'sqlite:blinko_local.db';
let dbPromise: Promise<any> | null = null;
let dbReady = false;
const memoryTrpcCache = new Map<string, { value: unknown; updatedAt: number }>();

const isInTauri = () => {
  try {
    return typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined;
  } catch {
    return false;
  }
};

const normalizeUserId = (value?: unknown): string => {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+(\.0+)?$/.test(raw)) return String(Number(raw));
  return raw;
};

const normalizeNoteId = (value?: unknown): string => {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^-?\d+$/.test(raw)) return raw;
  return raw;
};

const buildUserCandidates = (userId: string): string[] => {
  const normalized = normalizeUserId(userId);
  if (!normalized) return [];
  const candidates = new Set<string>([normalized]);
  if (/^\d+$/.test(normalized)) {
    candidates.add(`${normalized}.0`);
  }
  return [...candidates];
};

const loadDb = async () => {
  if (!isInTauri()) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const mod = await import('@tauri-apps/plugin-sql');
      const Database = (mod as any).default ?? (mod as any).Database;
      if (!Database?.load) throw new Error('plugin-sql not available');
      return await Database.load(DB_URL);
    })().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return await dbPromise;
};

export const initLocalDb = async () => {
  const db = await loadDb();
  if (!db || dbReady) return;

  await db.execute(
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  );
  await db.execute(
    'CREATE TABLE IF NOT EXISTS cached_notes (user_id TEXT NOT NULL, local_id TEXT NOT NULL, server_id TEXT, note_json TEXT NOT NULL, cached_at INTEGER NOT NULL, PRIMARY KEY (user_id, local_id))'
  );
  await db.execute(
    'CREATE TABLE IF NOT EXISTS pending_ops (user_id TEXT NOT NULL, local_id TEXT NOT NULL, op TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, local_id))'
  );
  await db.execute(
    'CREATE TABLE IF NOT EXISTS cached_trpc (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'
  );
  await db.execute(
    'CREATE TABLE IF NOT EXISTS local_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, nickname TEXT, role TEXT, image TEXT, token TEXT, created_at INTEGER NOT NULL)'
  );
  await db.execute('CREATE INDEX IF NOT EXISTS idx_cached_notes_user ON cached_notes(user_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_pending_ops_user ON pending_ops(user_id)');

  try {
    const rows = (await db.select(
      'SELECT DISTINCT CAST(user_id AS TEXT) AS id FROM cached_notes UNION SELECT DISTINCT CAST(user_id AS TEXT) AS id FROM pending_ops',
    )) as SqlRow[];
    for (const row of rows) {
      const raw = String(row?.id ?? '');
      const normalized = normalizeUserId(raw);
      if (raw && normalized && raw !== normalized) {
        await db.execute('UPDATE cached_notes SET user_id = ? WHERE user_id = ?', [normalized, raw]);
        await db.execute('UPDATE pending_ops SET user_id = ? WHERE user_id = ?', [normalized, raw]);
        await db.execute('UPDATE meta SET value = ? WHERE key = ? AND value = ?', [normalized, 'last_user_id', raw]);
      }
    }
  } catch {
    // ignore normalize failures
  }

  dbReady = true;
};

export const setLastUserId = async (userId: unknown) => {
  const db = await loadDb();
  if (!db) return '';
  await initLocalDb();
  const normalized = normalizeUserId(userId);
  if (normalized) {
    await db.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'last_user_id',
      normalized,
    ]);
  }
  return normalized;
};

export const getEffectiveUserId = async (userId: unknown) => {
  const db = await loadDb();
  if (!db) return '';
  await initLocalDb();

  const direct = normalizeUserId(userId);
  if (direct) {
    await setLastUserId(direct);
    return direct;
  }

  const rows = (await db.select('SELECT value FROM meta WHERE key = ?', ['last_user_id'])) as SqlRow[];
  return normalizeUserId(rows?.[0]?.value);
};

const parseNote = (raw: unknown): Note | null => {
  if (typeof raw !== 'string') return null;
  try {
    const note = JSON.parse(raw) as Note;
    if (!note?.id) return null;
    return note;
  } catch {
    return null;
  }
};

export const cacheUpsertServerNotes = async (userId: unknown, serverNotes: Note[]) => {
  const db = await loadDb();
  if (!db) return [] as Note[];
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return [] as Note[];

  const candidates = buildUserCandidates(effectiveUserId);
  const localNotes: Note[] = [];
  const now = Date.now();
  for (const serverNote of serverNotes) {
    const serverId = String(serverNote.id);
    const rows = (await db.select(
      `SELECT local_id FROM cached_notes WHERE user_id IN (${candidates.map(() => '?').join(',')}) AND server_id = ? LIMIT 1`,
      [...candidates, serverId],
    )) as SqlRow[];

    const existingLocalId = rows?.[0]?.local_id ? String(rows[0].local_id) : serverId;
    const localId = normalizeNoteId(existingLocalId) || serverId;
    const localNote: any = { ...serverNote };
    localNote.id = Number(localId);
    localNote.metadata = { ...(serverNote as any)?.metadata, serverId: Number(serverId) };

    await db.execute(
      'INSERT OR REPLACE INTO cached_notes (user_id, local_id, server_id, note_json, cached_at) VALUES (?, ?, ?, ?, ?)',
      [effectiveUserId, localId, serverId, JSON.stringify(localNote), now],
    );
    localNotes.push(localNote);
  }

  await setLastUserId(effectiveUserId);
  return localNotes;
};

export const cacheUpsertLocalNote = async (userId: unknown, note: Note, serverId?: number | null) => {
  const db = await loadDb();
  if (!db) return;
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return;

  const now = Date.now();
  const localId = normalizeNoteId(note.id);
  if (!localId) return;
  const sid = serverId ?? (note as any)?.metadata?.serverId ?? null;
  await db.execute(
    'INSERT OR REPLACE INTO cached_notes (user_id, local_id, server_id, note_json, cached_at) VALUES (?, ?, ?, ?, ?)',
    [effectiveUserId, localId, sid ? String(sid) : null, JSON.stringify(note), now],
  );
};

export const getServerIdForLocal = async (userId: unknown, localId: number): Promise<number | null> => {
  const db = await loadDb();
  if (!db) return null;
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return null;

  const candidates = buildUserCandidates(effectiveUserId);
  const rows = (await db.select(
    `SELECT server_id FROM cached_notes WHERE user_id IN (${candidates.map(() => '?').join(',')}) AND local_id = ? LIMIT 1`,
    [...candidates, String(localId)],
  )) as SqlRow[];

  const serverId = rows?.[0]?.server_id ? String(rows[0].server_id) : '';
  if (!serverId) return null;
  const asNumber = Number(serverId);
  return Number.isNaN(asNumber) ? null : asNumber;
};

export const cacheReplaceLocalWithServer = async (userId: unknown, localId: number, serverNote: Note) => {
  const db = await loadDb();
  if (!db) return;
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return;

  const serverId = String(serverNote.id);
  const localNote: any = { ...serverNote };
  localNote.id = localId;
  localNote.metadata = { ...(serverNote as any)?.metadata, serverId: Number(serverId) };
  const now = Date.now();

  await db.execute(
    'INSERT OR REPLACE INTO cached_notes (user_id, local_id, server_id, note_json, cached_at) VALUES (?, ?, ?, ?, ?)',
    [effectiveUserId, String(localId), serverId, JSON.stringify(localNote), now],
  );
};

export const listCachedNotesLocal = async (userId: unknown) => {
  const db = await loadDb();
  if (!db) return [] as Note[];
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return [] as Note[];

  const candidates = buildUserCandidates(effectiveUserId);
  const rows = (await db.select(
    `SELECT note_json FROM cached_notes WHERE user_id IN (${candidates.map(() => '?').join(',')}) ORDER BY cached_at DESC`,
    candidates,
  )) as SqlRow[];

  return (rows ?? []).map((row) => parseNote(row?.note_json)).filter(Boolean) as Note[];
};

export const getCachedNoteLocal = async (userId: unknown, localId: number) => {
  const db = await loadDb();
  if (!db) return null;
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return null;

  const candidates = buildUserCandidates(effectiveUserId);
  const rows = (await db.select(
    `SELECT note_json FROM cached_notes WHERE user_id IN (${candidates.map(() => '?').join(',')}) AND local_id = ? LIMIT 1`,
    [...candidates, String(localId)],
  )) as SqlRow[];

  return parseNote(rows?.[0]?.note_json);
};

export type PendingOp = { localId: number; op: 'create' | 'update'; note: Note; updatedAt: number };

export const listPendingOps = async (userId: unknown): Promise<PendingOp[]> => {
  const db = await loadDb();
  if (!db) return [];
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return [];

  const candidates = buildUserCandidates(effectiveUserId);
  const rows = (await db.select(
    `SELECT local_id, op, payload_json, updated_at FROM pending_ops WHERE user_id IN (${candidates.map(() => '?').join(',')}) ORDER BY updated_at ASC`,
    candidates,
  )) as SqlRow[];

  return (rows ?? [])
    .map((row) => {
      const localId = Number(row?.local_id);
      const op = String(row?.op) as 'create' | 'update';
      const note = parseNote(row?.payload_json);
      const updatedAt = Number(row?.updated_at ?? 0);
      if (!localId || !note) return null;
      return { localId, op, note, updatedAt };
    })
    .filter(Boolean) as PendingOp[];
};

export const upsertPendingOp = async (userId: unknown, op: PendingOp['op'], note: Note) => {
  const db = await loadDb();
  if (!db) return;
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return;

  const now = Date.now();
  await db.execute(
    'INSERT OR REPLACE INTO pending_ops (user_id, local_id, op, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)',
    [effectiveUserId, String(note.id), op, JSON.stringify(note), now],
  );
};

export const deletePendingOp = async (userId: unknown, localId: number) => {
  const db = await loadDb();
  if (!db) return;
  const effectiveUserId = await getEffectiveUserId(userId);
  if (!effectiveUserId) return;

  const candidates = buildUserCandidates(effectiveUserId);
  await db.execute(
    `DELETE FROM pending_ops WHERE user_id IN (${candidates.map(() => '?').join(',')}) AND local_id = ?`,
    [...candidates, String(localId)],
  );
};

export const setCachedTrpc = async (key: string, value: unknown) => {
  const db = await loadDb();
  if (!db) {
    memoryTrpcCache.set(key, { value: superjson.serialize(value), updatedAt: Date.now() });
    return;
  }
  await initLocalDb();
  const serialized = superjson.serialize(value);
  await db.execute(
    'INSERT OR REPLACE INTO cached_trpc (key, value, updated_at) VALUES (?, ?, ?)',
    [key, JSON.stringify(serialized), Date.now()],
  );
};

export const getCachedTrpc = async <T = unknown>(key: string): Promise<T | null> => {
  const db = await loadDb();
  if (!db) {
    const cached = memoryTrpcCache.get(key);
    if (!cached) return null;
    try {
      return superjson.deserialize(cached.value) as T;
    } catch {
      return null;
    }
  }
  await initLocalDb();
  const rows = (await db.select('SELECT value FROM cached_trpc WHERE key = ? LIMIT 1', [key])) as SqlRow[];
  const raw = rows?.[0]?.value ? String(rows[0].value) : '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return superjson.deserialize(parsed) as T;
  } catch {
    return null;
  }
};

type LocalUser = {
  id: number;
  name: string;
  nickname: string;
  role: string;
  image: string | null;
  token: string;
};

const mapLocalUser = (row: SqlRow): LocalUser => ({
  id: Number(row?.id ?? 0),
  name: String(row?.name ?? ''),
  nickname: String(row?.nickname ?? ''),
  role: String(row?.role ?? 'user'),
  image: row?.image ? String(row.image) : null,
  token: String(row?.token ?? ''),
});

export const countLocalUsers = async (): Promise<number> => {
  const db = await loadDb();
  if (!db) return 0;
  await initLocalDb();
  const rows = (await db.select('SELECT COUNT(*) as count FROM local_users')) as SqlRow[];
  return Number(rows?.[0]?.count ?? 0);
};

export const listLocalUsers = async (): Promise<LocalUser[]> => {
  const db = await loadDb();
  if (!db) return [];
  await initLocalDb();
  const rows = (await db.select('SELECT id, name, nickname, role, image, token FROM local_users ORDER BY id ASC')) as SqlRow[];
  return (rows ?? []).map(mapLocalUser);
};

export const getLocalUserByName = async (name: string): Promise<LocalUser | null> => {
  const db = await loadDb();
  if (!db) return null;
  await initLocalDb();
  const rows = (await db.select(
    'SELECT id, name, nickname, role, image, token FROM local_users WHERE name = ? LIMIT 1',
    [name],
  )) as SqlRow[];
  if (!rows?.length) return null;
  return mapLocalUser(rows[0]);
};

export const getLocalUserById = async (id: number): Promise<LocalUser | null> => {
  const db = await loadDb();
  if (!db) return null;
  await initLocalDb();
  const rows = (await db.select(
    'SELECT id, name, nickname, role, image, token FROM local_users WHERE id = ? LIMIT 1',
    [id],
  )) as SqlRow[];
  if (!rows?.length) return null;
  return mapLocalUser(rows[0]);
};

export const getLocalUserAuthRecord = async (name: string) => {
  const db = await loadDb();
  if (!db) return null;
  await initLocalDb();
  const rows = (await db.select(
    'SELECT id, name, nickname, role, image, token, password_hash, password_salt FROM local_users WHERE name = ? LIMIT 1',
    [name],
  )) as SqlRow[];
  if (!rows?.length) return null;
  return rows[0];
};

export const getLocalUserAuthRecordById = async (id: number) => {
  const db = await loadDb();
  if (!db) return null;
  await initLocalDb();
  const rows = (await db.select(
    'SELECT id, name, nickname, role, image, token, password_hash, password_salt FROM local_users WHERE id = ? LIMIT 1',
    [id],
  )) as SqlRow[];
  if (!rows?.length) return null;
  return rows[0];
};

export const createLocalUser = async (args: {
  name: string;
  passwordHash: string;
  passwordSalt: string;
  nickname?: string;
  role?: string;
  image?: string | null;
  token: string;
}): Promise<LocalUser> => {
  const db = await loadDb();
  if (!db) {
    throw new Error('Local database not available');
  }
  await initLocalDb();
  const now = Date.now();
  await db.execute(
    'INSERT INTO local_users (name, password_hash, password_salt, nickname, role, image, token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      args.name,
      args.passwordHash,
      args.passwordSalt,
      args.nickname ?? args.name,
      args.role ?? 'user',
      args.image ?? null,
      args.token,
      now,
    ],
  );
  const user = await getLocalUserByName(args.name);
  if (!user) throw new Error('Failed to create local user');
  return user;
};

export const updateLocalUserToken = async (id: number, token: string) => {
  const db = await loadDb();
  if (!db) return;
  await initLocalDb();
  await db.execute('UPDATE local_users SET token = ? WHERE id = ?', [token, id]);
};

export const updateLocalUser = async (args: {
  id: number;
  name?: string;
  nickname?: string;
  image?: string;
  passwordHash?: string;
  passwordSalt?: string;
}) => {
  const db = await loadDb();
  if (!db) return;
  await initLocalDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (args.name) {
    fields.push('name = ?');
    values.push(args.name);
  }
  if (args.nickname) {
    fields.push('nickname = ?');
    values.push(args.nickname);
  }
  if (args.image !== undefined) {
    fields.push('image = ?');
    values.push(args.image ?? null);
  }
  if (args.passwordHash && args.passwordSalt) {
    fields.push('password_hash = ?');
    values.push(args.passwordHash);
    fields.push('password_salt = ?');
    values.push(args.passwordSalt);
  }
  if (!fields.length) return;
  values.push(args.id);
  await db.execute(`UPDATE local_users SET ${fields.join(', ')} WHERE id = ?`, values);
};

export const deleteLocalUser = async (id: number) => {
  const db = await loadDb();
  if (!db) return;
  await initLocalDb();
  await db.execute('DELETE FROM local_users WHERE id = ?', [id]);
};
