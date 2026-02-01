import type { Attachment, Note, NoteType } from '../lib/types';
import type { LocalBackendContext } from './types';
import { mergeNotes, matchesOfflineFilters, sortNotes } from './offlineNoteUtils';

const makeLocalId = () => -Date.now();

const normalizeReferences = (refs?: number[]) => (refs ?? []).map((toNoteId) => ({ toNoteId }));

export const createLocalNotesService = (ctx: LocalBackendContext) => {
  const getUserId = () => ctx.getUserId();
  const nowProvider = ctx.now ?? (() => new Date());

  return {
    async list(params: any): Promise<Note[]> {
      const userId = getUserId();
      await ctx.db.init();
      const page = Number(params?.page ?? 1);
      const size = Number(params?.size ?? 30);
      const searchText = params?.searchText ?? '';

      const filterConfig = { ...params };
      delete filterConfig.page;
      delete filterConfig.size;
      delete filterConfig.searchText;

      const cached = await ctx.db.listCachedNotesLocal(userId);
      const pending = (await ctx.db.listPendingOps(userId)).map((op) => op.note);
      const merged = mergeNotes(pending, cached);
      const filtered = merged.filter((note) => matchesOfflineFilters(note, filterConfig, searchText));
      const sorted = sortNotes(filtered, {
        direction: filterConfig?.orderBy ?? 'desc',
        useCreatedAt: Boolean(filterConfig?.useCreatedAt ?? false),
      });

      const start = (page - 1) * size;
      return sorted.slice(start, start + size);
    },

    async detail({ id }: { id: number }): Promise<Note | null> {
      const userId = getUserId();
      await ctx.db.init();
      const pending = await ctx.db.listPendingOps(userId);
      const hit = pending.find((op) => op.localId === id);
      if (hit?.note) return hit.note;
      return await ctx.db.getCachedNoteLocal(userId, id);
    },

    async listByIds(params: { ids: number[] }): Promise<Note[]> {
      const userId = getUserId();
      await ctx.db.init();
      const cached = await ctx.db.listCachedNotesLocal(userId);
      const pending = (await ctx.db.listPendingOps(userId)).map((op) => op.note);
      const merged = mergeNotes(pending, cached);
      const lookup = new Set(params?.ids ?? []);
      return merged.filter((note) => lookup.has(note.id));
    },

    async upsert(params: {
      id?: number;
      content?: string | null;
      type?: NoteType;
      isArchived?: boolean;
      isRecycle?: boolean;
      isTop?: boolean;
      isShare?: boolean;
      attachments?: Attachment[];
      references?: number[];
      metadata?: any;
    }): Promise<Note> {
      const userId = getUserId();
      await ctx.db.init();
      const now = nowProvider();

      if (!params.id) {
        const id = makeLocalId();
        const note: Note = {
          id,
          content: params.content ?? '',
          type: (params.type ?? 0) as NoteType,
          isArchived: !!params.isArchived,
          isRecycle: !!params.isRecycle,
          isTop: !!params.isTop,
          isShare: !!params.isShare,
          attachments: params.attachments ?? [],
          references: normalizeReferences(params.references),
          createdAt: now,
          updatedAt: now,
          pendingSync: true,
          isOffline: true,
          metadata: { ...(params.metadata ?? {}), serverId: null },
          tags: [],
        } as Note;

        await ctx.db.upsertPendingOp(userId, 'create', note);
        await ctx.db.cacheUpsertLocalNote(userId, note, null);
        return note;
      }

      const cached = await ctx.db.getCachedNoteLocal(userId, params.id);
      const note: Note = {
        ...(cached ?? ({} as Note)),
        id: params.id,
        content: params.content ?? cached?.content ?? '',
        type: (params.type ?? cached?.type ?? 0) as NoteType,
        isArchived: params.isArchived ?? cached?.isArchived ?? false,
        isRecycle: params.isRecycle ?? cached?.isRecycle ?? false,
        isTop: params.isTop ?? cached?.isTop ?? false,
        isShare: params.isShare ?? cached?.isShare ?? false,
        attachments: params.attachments ?? cached?.attachments ?? [],
        references: normalizeReferences(
          params.references ?? cached?.references?.map((ref: any) => ref.toNoteId) ?? [],
        ),
        createdAt: cached?.createdAt ?? now,
        updatedAt: now,
        pendingSync: true,
        isOffline: true,
        metadata: { ...(cached as any)?.metadata, ...(params.metadata ?? {}) },
        tags: cached?.tags ?? [],
      } as Note;

      await ctx.db.upsertPendingOp(userId, 'update', note);
      await ctx.db.cacheUpsertLocalNote(userId, note, (note as any)?.metadata?.serverId ?? null);
      return note;
    },
  };
};
