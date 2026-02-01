import fs from 'fs';
import path from 'path';
import { Database } from 'bun:sqlite';

const normalizeUserId = (value) => {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+(\.0+)?$/.test(raw)) return String(Number(raw));
  return raw;
};

const normalizeNoteId = (value) => {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^-?\d+$/.test(raw)) return raw;
  return raw;
};

const buildUserCandidates = (userId) => {
  const normalized = normalizeUserId(userId);
  if (!normalized) return [];
  const set = new Set([normalized]);
  if (/^\d+$/.test(normalized)) set.add(`${normalized}.0`);
  return [...set];
};

const parseNote = (raw) => {
  if (typeof raw !== 'string') return null;
  try {
    const note = JSON.parse(raw);
    if (!note?.id) return null;
    return note;
  } catch {
    return null;
  }
};

export const createCliDbAdapter = (dbPath) => {
  let db = null;

  const ensureDb = () => {
    if (!db) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      db = new Database(dbPath);
    }
    return db;
  };

  const exec = (sql, params = []) => {
    const database = ensureDb();
    database.query(sql).run(...params);
  };

  const selectAll = (sql, params = []) => {
    const database = ensureDb();
    return database.query(sql).all(...params);
  };

  const selectOne = (sql, params = []) => {
    const database = ensureDb();
    return database.query(sql).get(...params);
  };

  const init = async () => {
    ensureDb();
    exec(`CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    exec(`CREATE TABLE IF NOT EXISTS cached_notes (
      user_id TEXT NOT NULL,
      local_id TEXT NOT NULL,
      server_id TEXT,
      note_json TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, local_id)
    )`);

    exec(`CREATE TABLE IF NOT EXISTS pending_ops (
      user_id TEXT NOT NULL,
      local_id TEXT NOT NULL,
      op TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, local_id)
    )`);

    exec(`CREATE TABLE IF NOT EXISTS cached_trpc (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    )`);

    exec(`CREATE INDEX IF NOT EXISTS idx_cached_notes_user ON cached_notes(user_id)`);
    exec(`CREATE INDEX IF NOT EXISTS idx_pending_ops_user ON pending_ops(user_id)`);

    try {
      const rows = selectAll(
        `SELECT DISTINCT CAST(user_id AS TEXT) AS id FROM cached_notes
         UNION
         SELECT DISTINCT CAST(user_id AS TEXT) AS id FROM pending_ops`,
      );
      for (const row of rows) {
        const raw = String(row?.id ?? '');
        const normalized = normalizeUserId(raw);
        if (raw && normalized && raw !== normalized) {
          exec(`UPDATE cached_notes SET user_id = ? WHERE user_id = ?`, [normalized, raw]);
          exec(`UPDATE pending_ops SET user_id = ? WHERE user_id = ?`, [normalized, raw]);
          exec(`UPDATE meta SET value = ? WHERE key = 'last_user_id' AND value = ?`, [normalized, raw]);
        }
      }
    } catch {
      // ignore
    }
  };

  const setLastUserId = async (userId) => {
    await init();
    const normalized = normalizeUserId(userId);
    if (normalized) {
      exec(`INSERT OR REPLACE INTO meta(key,value) VALUES('last_user_id', ?)`, [normalized]);
    }
    return normalized;
  };

  const getEffectiveUserId = async (userId) => {
    await init();
    const direct = normalizeUserId(userId);
    if (direct) {
      await setLastUserId(direct);
      return direct;
    }
    const row = selectOne(`SELECT value FROM meta WHERE key='last_user_id'`);
    return normalizeUserId(row?.value);
  };

  const cacheUpsertServerNotes = async (userId, serverNotes) => {
    await init();
    const effective = await getEffectiveUserId(userId);
    if (!effective) return;
    const candidates = buildUserCandidates(effective);
    if (!candidates.length) return;

    const now = Date.now();
    for (const serverNote of serverNotes) {
      const serverId = String(serverNote.id);
      const row = selectOne(
        `SELECT local_id FROM cached_notes
         WHERE user_id IN (${candidates.map(() => '?').join(',')}) AND server_id = ? LIMIT 1`,
        [...candidates, serverId],
      );

      const existingLocalId = row?.local_id ? String(row.local_id) : serverId;
      const localId = normalizeNoteId(existingLocalId) || serverId;

      const localNote = { ...serverNote };
      localNote.id = Number(localId);
      localNote.metadata = { ...(serverNote?.metadata ?? {}), serverId: Number(serverId) };

      exec(
        `INSERT OR REPLACE INTO cached_notes(user_id, local_id, server_id, note_json, cached_at)
         VALUES(?,?,?,?,?)`,
        [effective, localId, serverId, JSON.stringify(localNote), now],
      );
    }

    await setLastUserId(effective);
  };

  const listCachedNotesLocal = async (userId) => {
    await init();
    const effective = await getEffectiveUserId(userId);
    if (!effective) return [];
    const candidates = buildUserCandidates(effective);
    if (!candidates.length) return [];

    const rows = selectAll(
      `SELECT note_json FROM cached_notes
       WHERE user_id IN (${candidates.map(() => '?').join(',')})
       ORDER BY cached_at DESC`,
      candidates,
    );
    return rows.map((row) => parseNote(row?.note_json)).filter(Boolean);
  };

  const getCachedNoteLocal = async (userId, localId) => {
    await init();
    const effective = await getEffectiveUserId(userId);
    if (!effective) return null;
    const candidates = buildUserCandidates(effective);
    if (!candidates.length) return null;

    const row = selectOne(
      `SELECT note_json FROM cached_notes
       WHERE user_id IN (${candidates.map(() => '?').join(',')}) AND local_id = ? LIMIT 1`,
      [...candidates, String(localId)],
    );
    return parseNote(row?.note_json);
  };

  const cacheUpsertLocalNote = async (userId, note, serverId) => {
    await init();
    const effective = await getEffectiveUserId(userId);
    if (!effective) return;
    const now = Date.now();
    const localId = String(note.id);
    const sid = serverId ?? note?.metadata?.serverId ?? null;
    exec(
      `INSERT OR REPLACE INTO cached_notes(user_id, local_id, server_id, note_json, cached_at)
       VALUES(?,?,?,?,?)`,
      [effective, localId, sid ? String(sid) : null, JSON.stringify(note), now],
    );
  };

  const listPendingOps = async (userId) => {
    await init();
    const effective = await getEffectiveUserId(userId);
    if (!effective) return [];
    const candidates = buildUserCandidates(effective);
    if (!candidates.length) return [];

    const rows = selectAll(
      `SELECT local_id, op, payload_json, updated_at FROM pending_ops
       WHERE user_id IN (${candidates.map(() => '?').join(',')})
       ORDER BY updated_at ASC`,
      candidates,
    );

    return rows
      .map((row) => {
        const localId = Number(row?.local_id);
        const op = String(row?.op);
        const note = parseNote(row?.payload_json);
        const updatedAt = Number(row?.updated_at ?? 0);
        if (!localId || !note) return null;
        return { localId, op, note, updatedAt };
      })
      .filter(Boolean);
  };

  const upsertPendingOp = async (userId, op, note) => {
    await init();
    const effective = await getEffectiveUserId(userId);
    if (!effective) return;
    const now = Date.now();
    exec(
      `INSERT OR REPLACE INTO pending_ops(user_id, local_id, op, payload_json, updated_at)
       VALUES(?,?,?,?,?)`,
      [effective, String(note.id), op, JSON.stringify(note), now],
    );
  };

  const deletePendingOp = async (userId, localId) => {
    await init();
    const effective = await getEffectiveUserId(userId);
    if (!effective) return;
    const candidates = buildUserCandidates(effective);
    if (!candidates.length) return;
    exec(
      `DELETE FROM pending_ops WHERE user_id IN (${candidates.map(() => '?').join(',')}) AND local_id = ?`,
      [...candidates, String(localId)],
    );
  };

  return {
    init,
    getEffectiveUserId,
    setLastUserId,
    cacheUpsertServerNotes,
    listCachedNotesLocal,
    getCachedNoteLocal,
    cacheUpsertLocalNote,
    listPendingOps,
    upsertPendingOp,
    deletePendingOp,
  };
};
