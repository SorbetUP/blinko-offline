import type { LocalDbAdapter } from '../../../shared/local-backend/types';
import {
  cacheUpsertLocalNote,
  cacheUpsertServerNotes,
  deletePendingOp,
  getCachedNoteLocal,
  getEffectiveUserId,
  initLocalDb,
  listCachedNotesLocal,
  listPendingOps,
  setLastUserId,
  upsertPendingOp,
} from './localDb';

export const tauriDbAdapter: LocalDbAdapter = {
  async init() {
    await initLocalDb();
  },
  async getEffectiveUserId(userId) {
    return await getEffectiveUserId(userId);
  },
  async setLastUserId(userId) {
    return await setLastUserId(userId);
  },
  async cacheUpsertServerNotes(userId, serverNotes) {
    await cacheUpsertServerNotes(userId, serverNotes);
  },
  async listCachedNotesLocal(userId) {
    return await listCachedNotesLocal(userId);
  },
  async getCachedNoteLocal(userId, localId) {
    return await getCachedNoteLocal(userId, localId);
  },
  async cacheUpsertLocalNote(userId, note, serverId) {
    await cacheUpsertLocalNote(userId, note, serverId ?? null);
  },
  async listPendingOps(userId) {
    return await listPendingOps(userId);
  },
  async upsertPendingOp(userId, op, note) {
    await upsertPendingOp(userId, op, note);
  },
  async deletePendingOp(userId, localId) {
    await deletePendingOp(userId, localId);
  },
};
