"use client";
import { useEffect } from 'react';
import { PromisePageState, PromiseState } from './standard/PromiseState';
import { Store } from './standard/base';
import { db, type DBNote } from '@/lib/db';
import { helper } from '@/lib/helper';
import { ToastPlugin } from './module/Toast/Toast';
import { RootStore } from './root';
import { eventBus } from '@/lib/event';
import { StorageListState } from './standard/StorageListState';
import i18n from '@/lib/i18n';
import { api } from '@/lib/trpc';
import { Attachment, NoteType, type Note } from '@shared/lib/types';
import { ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME } from '@shared/lib/sharedConstant';
import { makeAutoObservable, toJS } from 'mobx';
import { UserStore } from './user';
import { BaseStore } from './baseStore';
import { StorageState } from './standard/StorageState';
import { SyncQueueStore } from './sync/syncQueueStore';
import { useSearchParams, useLocation } from 'react-router-dom';

type filterType = {
  label: string;
  sortBy: string;
  direction: string;
}

// Interface for note upsert parameters
interface UpsertNoteParams {
  /** Note content */
  content?: string | null;
  /** Whether the note is archived */
  isArchived?: boolean;
  /** Whether the note is in recycle bin */
  isRecycle?: boolean;
  /** Note type */
  type?: NoteType;
  /** Note ID */
  id?: number;
  /** List of attachments */
  attachments?: Attachment[];
  /** Whether to refresh the list after operation */
  refresh?: boolean;
  /** Whether the note is pinned to top */
  isTop?: boolean;
  /** Whether the note is publicly shared */
  isShare?: boolean;
  /** Whether to show toast notification */
  showToast?: boolean;
  /** List of referenced note IDs */
  references?: number[];
  /** Creation time */
  createdAt?: Date;
  /** Last update time */
  updatedAt?: Date;
  /** Metadata */
  metadata?: any;
}

interface OfflineNote extends Omit<Note, 'id' | 'references'> {
  id: number;
  isOffline: boolean;
  pendingSync: boolean;
  references: { toNoteId: number }[];
}

export class BlinkoStore implements Store {
  sid = 'BlinkoStore';
  noteContent = '';
  createContentStorage = new StorageState<{ content: string }>({
    key: 'createModeNote',
    default: { content: '' }
  });
  createAttachmentsStorage = new StorageListState<{ name: string, path: string, type: string, size: number }>({
    key: 'createModeAttachments',
  });
  editContentStorage = new StorageListState<{ content: string, id: number }>({
    key: 'editModeNotes'
  });
  editAttachmentsStorage = new StorageListState<{ name: string, path: string, type: string, size: number, id: number }>({
    key: 'editModeAttachments'
  });

  searchText: string = '';
  isCreateMode: boolean = true
  curSelectedNote: Note | null = null;
  curMultiSelectIds: number[] = [];
  isMultiSelectMode: boolean = false;
  forceQuery: number = 0;
  isSyncing: boolean = false;
  allTagRouter = {
    title: 'total',
    href: '/?path=all',
    icon: ''
  }
  noteListFilterConfig = {
    isArchived: false as boolean | null,
    isRecycle: false,
    isShare: null as boolean | null,
    type: 0,
    tagId: null as number | null,
    withoutTag: false,
    withFile: false,
    withLink: false,
    isUseAiQuery: false,
    startDate: null as Date | null,
    endDate: null as Date | null,
    hasTodo: false
  }
  noteTypeDefault: NoteType = NoteType.BLINKO
  currentCommonFilter: filterType | null = null
  updateTicker = 0
  fullNoteList: Note[] = []

  // For global search
  globalSearchTerm!: '';
  // Will be set to true when the global search modal is opened
  isGlobalSearchOpen!: false;
  // For search results presentation
  searchResults = {
    notes: [],
    resources: [],
    settings: []
  };

  offlineNoteStorage = new StorageListState<OfflineNote>({ key: 'offlineNotes' });

  get offlineNotes(): OfflineNote[] {
    return this.offlineNoteStorage.list;
  }

  get isOnline(): boolean {
    return RootStore.Get(BaseStore).isOnline;
  }

  private normalizeDbNote(note: DBNote) {
    const syncStatus = note.syncStatus ?? 'synced';
    return {
      ...note,
      isOffline: syncStatus !== 'synced',
      isExpand: false
    };
  }

  private resolveNoteType(type?: NoteType) {
    return type ?? this.noteTypeDefault ?? NoteType.BLINKO;
  }

  private normalizeReferenceIds(references: unknown) {
    if (!Array.isArray(references)) {
      return references === undefined ? undefined : [];
    }
    return references
      .map((ref) => (typeof ref === 'number' ? ref : (ref as { toNoteId?: number }).toNoteId))
      .filter((refId): refId is number => typeof refId === 'number');
  }

  private isNetworkError(error: unknown) {
    if (!error) return false;
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('load failed')) {
      return true;
    }
    const errorCode = (error as { code?: string }).code;
    return Boolean(errorCode && ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(errorCode));
  }

  private async saveNoteOffline(params: UpsertNoteParams) {
    const {
      content = null,
      isArchived,
      isRecycle,
      type,
      id,
      attachments = [],
      refresh = true,
      isTop,
      isShare,
      showToast = true,
      references = [],
      metadata
    } = params;

    const resolvedType = this.resolveNoteType(type);
    const now = Date.now();
    const nowDate = new Date(now);
    const plainAttachments = attachments !== undefined ? toJS(attachments) : undefined;
    const plainReferences = references !== undefined ? toJS(references) : undefined;
    const plainMetadata = metadata !== undefined ? toJS(metadata) : undefined;

    if (!id) {
      const normalizedReferences = (plainReferences ?? []).map(refId => ({ toNoteId: refId }));
      // CREATE: new note offline
      const dbNote = {
        id: now,
        accountId: Number(RootStore.Get(UserStore).id),
        content: content || '',
        type: resolvedType,
        isArchived: !!isArchived,
        isRecycle: !!isRecycle,
        attachments: plainAttachments ?? [],
        isTop: !!isTop,
        isShare: !!isShare,
        references: normalizedReferences,
        createdAt: nowDate,
        updatedAt: nowDate,
        tags: [],
        metadata: plainMetadata ?? {},
        localUpdatedAt: now,
        syncStatus: 'pending' as const
      };

      try {
        await db.notes.add(dbNote);
      } catch (error) {
        console.error('[OFFLINE] Failed to save note to IndexedDB:', error);
        RootStore.Get(ToastPlugin).addToast({
          type: 'error',
          title: i18n.t('error'),
          description: 'Impossible de sauvegarder la note localement'
        });
        throw error;
      }
      await RootStore.Get(SyncQueueStore).enqueue({
        operationType: 'create',
        entityType: 'note',
        entityId: dbNote.id,
        data: dbNote,
        status: 'pending'
      });
      showToast && RootStore.Get(ToastPlugin).success(i18n.t("create-successfully") + '-' + i18n.t("offline-status"));
      refresh && this.updateTicker++;
      return dbNote;
    }

    // UPDATE: existing note offline
    const existingNote = await db.notes.get(id);
    const normalizedReferences = plainReferences !== undefined
      ? plainReferences.map(refId => ({ toNoteId: refId }))
      : existingNote?.references ?? [];
    const updatedNote = {
      ...existingNote,
      accountId: existingNote?.accountId || Number(RootStore.Get(UserStore).id),
      content: content !== undefined ? content : existingNote?.content ?? '',
      type: type !== undefined ? type : existingNote?.type ?? resolvedType,
      isArchived: isArchived !== undefined ? isArchived : existingNote?.isArchived,
      isRecycle: isRecycle !== undefined ? isRecycle : existingNote?.isRecycle,
      isTop: isTop !== undefined ? isTop : existingNote?.isTop,
      isShare: isShare !== undefined ? isShare : existingNote?.isShare,
      attachments: plainAttachments !== undefined ? plainAttachments : existingNote?.attachments,
      references: normalizedReferences,
      metadata: plainMetadata !== undefined ? plainMetadata : existingNote?.metadata,
      updatedAt: nowDate,
      localUpdatedAt: now,
      syncStatus: 'pending' as const
    };

    try {
      await db.notes.put(updatedNote as any);
    } catch (error) {
      console.error('[OFFLINE] Failed to update note in IndexedDB:', error);
      RootStore.Get(ToastPlugin).addToast({
        type: 'error',
        title: i18n.t('error'),
        description: 'Impossible de mettre à jour la note localement'
      });
      throw error;
    }
    await RootStore.Get(SyncQueueStore).enqueue({
      operationType: 'update',
      entityType: 'note',
      entityId: id,
      data: updatedNote,
      status: 'pending'
    });
    showToast && RootStore.Get(ToastPlugin).success(i18n.t("update-successfully") + '-' + i18n.t("offline-status"));
    refresh && this.updateTicker++;
    return updatedNote;
  }

  private getLocalTimestamp(note: Note) {
    const candidate = note.updatedAt ?? note.createdAt;
    const timestamp = candidate ? new Date(candidate as any).getTime() : NaN;
    return Number.isNaN(timestamp) ? Date.now() : timestamp;
  }

  private getSortTimestamp(note: Note | DBNote) {
    const orderByCreate = Boolean(this.config.value?.isOrderByCreateTime);
    const preferred = orderByCreate ? note.createdAt : note.updatedAt;
    if (preferred) {
      const preferredTimestamp = new Date(preferred as any).getTime();
      if (!Number.isNaN(preferredTimestamp)) {
        return preferredTimestamp;
      }
    }
    const localUpdatedAt = (note as DBNote).localUpdatedAt;
    if (typeof localUpdatedAt === 'number') {
      return localUpdatedAt;
    }
    return this.getLocalTimestamp(note as Note);
  }

  private async cacheServerNotes(notes: Note[]) {
    if (!notes?.length) return;

    const ids = notes
      .map(note => note?.id)
      .filter((id): id is number => typeof id === 'number');

    if (ids.length === 0) return;

    const localNotes = await db.notes.where('id').anyOf(ids).toArray();
    const localById = new Map(localNotes.map(note => [note.id, note]));
    const toCache: DBNote[] = [];

    for (const note of notes) {
      if (typeof note?.id !== 'number') continue;
      const local = localById.get(note.id);
      if (local && local.syncStatus !== 'synced') {
        continue;
      }

      toCache.push({
        ...note,
        localUpdatedAt: this.getLocalTimestamp(note),
        syncStatus: 'synced' as const
      } as DBNote);
    }

    if (toCache.length > 0) {
      await db.notes.bulkPut(toCache);
    }
  }

  private saveOfflineNote(note: OfflineNote) {
    this.offlineNoteStorage.push(note);
  }

  private removeOfflineNote(id: number) {
    const index = this.offlineNoteStorage.list?.findIndex(note => note.id === id);
    if (index !== -1) {
      this.offlineNoteStorage.remove(index);
    }
  }

  private async getFilteredNotes(params: {
    page: number;
    size: number;
    filterConfig: any;
    offlineFilter?: (note: any) => boolean | undefined;
  }) {
    const { page, size, filterConfig, offlineFilter = () => true } = params;

    // Always load cached notes first for offline fallback
    const cachedNotes = await db.notes.toArray();
    const sortedCachedNotes = [...cachedNotes].sort(
      (a, b) => this.getSortTimestamp(b) - this.getSortTimestamp(a)
    );
    const filteredCachedNotes = sortedCachedNotes.filter(offlineFilter);

    const isBrowserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!this.isOnline && !isBrowserOnline) {
      // Pure offline mode
      const start = (page - 1) * size;
      const end = start + size;
      return filteredCachedNotes
        .slice(start, end)
        .map(note => this.normalizeDbNote(note));
    }

    // Try online fetch
    try {
      const queryParams = {
        ...this.noteListFilterConfig,
        ...filterConfig,
        searchText: this.searchText,
        page,
        size
      };
      const notes = await api.notes.list.mutate(queryParams);
      await this.cacheServerNotes(notes);

      // Trigger sync if there are pending offline operations
      const pendingCount = await db.syncQueue.where('status').equals('pending').count();
      if (pendingCount > 0) {
        await this.syncOfflineNotes();
      }

      // Merge offline pending notes with online notes (avoid duplicates)
      const pendingNotes = cachedNotes
        .filter(note => note.syncStatus !== 'synced')
        .sort((a, b) => this.getSortTimestamp(b) - this.getSortTimestamp(a));
      const filteredPendingNotes = pendingNotes.filter(offlineFilter);
      const pendingIds = new Set(filteredPendingNotes.map(note => note.id));
      const mergedNotes = [
        ...filteredPendingNotes.map(note => this.normalizeDbNote(note)),
        ...notes.filter(note => note?.id === undefined || !pendingIds.has(note.id))
      ].map(note => ({ ...note, isExpand: false }));
      return mergedNotes.sort(
        (a, b) => this.getSortTimestamp(b as Note) - this.getSortTimestamp(a as Note)
      );
    } catch (error) {
      // Silently fallback to offline notes when fetch fails
      const start = (page - 1) * size;
      const end = start + size;
      return filteredCachedNotes
        .slice(start, end)
        .map(note => this.normalizeDbNote(note));
    }
  }

  upsertNote = new PromiseState({
    eventKey: 'upsertNote',
    function: async (params: UpsertNoteParams) => {
      const {
        content = null,
        isArchived,
        isRecycle,
        type,
        id,
        attachments = [],
        refresh = true,
        isTop,
        isShare,
        showToast = true,
        references = [],
        createdAt: inputCreatedAt,
        updatedAt: inputUpdatedAt,
        metadata
      } = params;

      // Offline mode: save to IndexedDB and queue for sync
      if (!this.isOnline) {
        return await this.saveNoteOffline(params);
      }

      try {
        const res = await api.notes.upsert.mutate({
          content,
          type,
          isArchived,
          isRecycle,
          id,
          attachments,
          isTop,
          isShare,
          references,
          createdAt: inputCreatedAt ? new Date(inputCreatedAt) : undefined,
          updatedAt: inputUpdatedAt ? new Date(inputUpdatedAt) : undefined,
          metadata
        });
        eventBus.emit('editor:clear')
        showToast && RootStore.Get(ToastPlugin).success(id ? i18n.t("update-successfully") : i18n.t("create-successfully"))
        refresh && this.updateTicker++
        return res
      } catch (error) {
        if (!this.isOnline || this.isNetworkError(error)) {
          return await this.saveNoteOffline(params);
        }
        throw error;
      }
    }
  })

  shareNote = new PromiseState({
    function: async (params: { id: number, isCancel: boolean, password?: string, expireAt?: Date }) => {
      const res = await api.notes.shareNote.mutate(params)
      RootStore.Get(ToastPlugin).success(i18n.t("operation-success"))
      this.updateTicker++
      return res
    }
  })

  internalShareNote = new PromiseState({
    function: async (params: { id: number, accountIds: number[], isCancel: boolean }) => {
      const res = await api.notes.internalShareNote.mutate(params)
      RootStore.Get(ToastPlugin).success(i18n.t("operation-success"))
      this.updateTicker++
      return res
    }
  })

  getInternalSharedUsers = new PromiseState({
    function: async (id: number) => {
      return await api.notes.getInternalSharedUsers.mutate({ id })
    }
  })

  async syncOfflineNotes() {
    if (!this.isOnline || this.isSyncing) return;
    const syncQueueStore = RootStore.Get(SyncQueueStore);
    if (!syncQueueStore.beginProcessing()) return;
    this.isSyncing = true;

    try {
      // Get all pending sync operations from the queue
      const pendingOps = await db.syncQueue
        .where('status')
        .equals('pending')
        .sortBy('timestamp');

      for (const op of pendingOps) {
      try {
        // Update status to in_progress
        await db.syncQueue.update(op.id!, { status: 'in_progress' as const });

        if (op.entityType === 'note') {
          const noteData = op.data as any;

          if (op.operationType === 'create') {
            // For CREATE: send note to server
            const { id, localUpdatedAt, syncStatus, ...serverData } = noteData;
            const referenceIds = this.normalizeReferenceIds(serverData.references);
            const result = await api.notes.upsert.mutate({
              ...serverData,
              references: referenceIds,
              showToast: false
            });

            // Update local note with server ID and mark as synced
            await db.notes.delete(id);
            await db.notes.put({
              ...result,
              localUpdatedAt: Date.now(),
              syncStatus: 'synced' as const
            });
          } else if (op.operationType === 'update') {
            // For UPDATE: send changes to server
            const { localUpdatedAt, syncStatus, ...serverData } = noteData;
            const referenceIds = this.normalizeReferenceIds(serverData.references);
            await api.notes.upsert.mutate({
              ...serverData,
              references: referenceIds,
              showToast: false
            });

            // Mark as synced
            await db.notes.update(noteData.id, {
              syncStatus: 'synced' as const
            });
          } else if (op.operationType === 'delete') {
            // For DELETE: just remove from IndexedDB (server already handles via isRecycle)
            // The delete is actually an UPDATE with isRecycle: true
          }
        }

        // Remove successfully synced operation from queue
        await db.syncQueue.delete(op.id!);

      } catch (error) {
        console.error('Failed to sync operation:', error);

        // Mark as failed and increment retry count
        const currentOp = await db.syncQueue.get(op.id!);
        if (currentOp) {
          await db.syncQueue.update(op.id!, {
            status: 'failed' as const,
            retryCount: currentOp.retryCount + 1
          });
        }
      }
      }

      // Reload queue stats
      await syncQueueStore.loadQueueStats();
    } finally {
      this.isSyncing = false;
      syncQueueStore.endProcessing();
    }
  }

  blinkoList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.BLINKO,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.BLINKO && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  noteOnlyList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.NOTE,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.NOTE && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  todoList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.TODO,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.TODO && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  archivedList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isArchived: true,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  trashList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isRecycle: true
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.isRecycle);
        }
      });
    }
  })

  noteList = new PromisePageState({
    function: async ({ page, size, ...filterConfig }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isArchived: false,
          ...filterConfig
        },
        offlineFilter: (note) => {
          // Exclude notes in recycle bin
          return !note.isRecycle;
        }
      });
    }
  })

  referenceSearchList = new PromisePageState({
    function: async ({ page, size, searchText }) => {
      return await api.notes.list.mutate({
        searchText
      })
    }
  })

  userList = new PromiseState({
    function: async () => {
      return await api.users.list.query()
    }
  })

  noteDetail = new PromiseState({
    function: async ({ id }) => {
      if (!this.isOnline) {
        const localNote = await db.notes.get(id);
        return localNote ? this.normalizeDbNote(localNote) : null;
      }

      try {
        const note = await api.notes.detail.mutate({ id });
        await this.cacheServerNotes([note]);
        return note;
      } catch (error) {
        const localNote = await db.notes.get(id);
        return localNote ? this.normalizeDbNote(localNote) : null;
      }
    }
  })

  dailyReviewNoteList = new PromiseState({
    function: async () => {
      return await api.notes.dailyReviewNoteList.query()
    }
  })

  randomReviewNoteList = new PromiseState({
    function: async ({ limit = 30 }) => {
      return await api.notes.randomNoteList.query({ limit })
    }
  })

  resourceList = new PromisePageState({
    function: async ({ page, size, searchText, folder }) => {
      return await api.attachments.list.query({ page, size, searchText, folder })
    }
  })

  tagList = new PromiseState({
    function: async () => {
      const falttenTags = await api.tags.list.query(undefined, { context: { skipBatch: true } });
      const listTags = helper.buildHashTagTreeFromDb(falttenTags)
      let pathTags: string[] = [];
      listTags.forEach(node => {
        pathTags = pathTags.concat(helper.generateTagPaths(node));
      });
      return { falttenTags, listTags, pathTags }
    }
  })

  get showAi() {
    return true
  }

  config = new PromiseState({
    loadingLock: false,
    function: async () => {
      const res = await api.config.list.query()
      return res
    }
  })

  task = new PromiseState({
    function: async () => {
      try {
        if (RootStore.Get(UserStore).role == 'superadmin') {
          return (await api.task.list.query()) ?? [];
        }
        return []
      } catch (error) {
        return []
      }
    }
  })

  updateDBTask = new PromiseState({
    function: async (isStart) => {
      if (isStart) {
        await api.task.upsertTask.mutate({ type: 'start', task: DBBAK_TASK_NAME })
      } else {
        await api.task.upsertTask.mutate({ type: 'stop', task: DBBAK_TASK_NAME })
      }
      await this.task.call()
    }
  })
  updateArchiveTask = new PromiseState({
    function: async (isStart) => {
      if (isStart) {
        await api.task.upsertTask.mutate({ type: 'start', task: ARCHIVE_BLINKO_TASK_NAME })
      } else {
        await api.task.upsertTask.mutate({ type: 'stop', task: ARCHIVE_BLINKO_TASK_NAME })
      }
      await this.task.call()
    }
  })


  get DBTask() {
    return this.task.value?.find(i => i.name == DBBAK_TASK_NAME)
  }

  get ArchiveTask() {
    return this.task.value?.find(i => i.name == ARCHIVE_BLINKO_TASK_NAME)
  }


  async onBottom() {
    const currentPath = new URLSearchParams(window.location.search).get('path');
    
    if (currentPath === 'notes') {
      await this.noteOnlyList.callNextPage({});
    } else if (currentPath === 'todo') {
      await this.todoList.callNextPage({});
    } else if (currentPath === 'archived') {
      await this.archivedList.callNextPage({});
    } else if (currentPath === 'trash') {
      await this.trashList.callNextPage({});
    } else if (currentPath === 'all') {
      this.noteList.resetAndCall({});
    } else {
      await this.blinkoList.callNextPage({});
    }
  }

  onMultiSelectNote(id: number) {
    if (this.curMultiSelectIds.includes(id)) {
      this.curMultiSelectIds = this.curMultiSelectIds.filter(item => item !== id);
    } else {
      this.curMultiSelectIds.push(id);
    }
    if (this.curMultiSelectIds.length == 0) {
      this.isMultiSelectMode = false
    }
  }

  onMultiSelectRest() {
    this.isMultiSelectMode = false
    this.curMultiSelectIds = []
    this.updateTicker++
  }

  async firstLoad() {
    // Fix notes without accountId (migration)
    try {
      const { fixNotesWithoutAccountId } = await import('@/lib/db/migrate');
      await fixNotesWithoutAccountId(Number(RootStore.Get(UserStore).id));
    } catch (error) {
      console.error('Failed to fix notes without accountId:', error);
    }

    this.tagList.call()
    this.config.call()
    this.dailyReviewNoteList.call()
    this.task.call()
  }


  async refreshData() {
    this.tagList.call()
    
    const currentPath = new URLSearchParams(window.location.search).get('path');
    
    if (currentPath === 'notes') {
      this.noteOnlyList.resetAndCall({});
    } else if (currentPath === 'todo') {
      this.todoList.resetAndCall({});
    } else if (currentPath === 'archived') {
      this.archivedList.resetAndCall({});
    } else if (currentPath === 'trash') {
      this.trashList.resetAndCall({});
    } else if (currentPath === 'all') {
      this.noteList.resetAndCall({});
    } else {
      this.blinkoList.resetAndCall({});
    }
    
    this.config.call()
    this.dailyReviewNoteList.call()
  }

  private clear() {
    this.createContentStorage.clear()
    this.editContentStorage.clear()
  }

  use() {
    useEffect(() => {
      if (RootStore.Get(UserStore).id) {
        this.firstLoad()
      }
    }, [RootStore.Get(UserStore).id])

    useEffect(() => {
      if (this.updateTicker == 0) return
      this.refreshData()
    }, [this.updateTicker])
  }

  useQuery() {
    const [searchParams] = useSearchParams();
    const location = useLocation();
    useEffect(() => {
      const tagId = searchParams.get('tagId');
      if (tagId && Number(tagId) === this.noteListFilterConfig.tagId) {
        return;
      }
      
      const withoutTag = searchParams.get('withoutTag');
      const withFile = searchParams.get('withFile');
      const withLink = searchParams.get('withLink');
      const searchText = searchParams.get('searchText') || this.searchText;
      const hasTodo = searchParams.get('hasTodo');
      const path = searchParams.get('path');

      this.noteListFilterConfig.type = NoteType.BLINKO
      this.noteTypeDefault = NoteType.BLINKO
      this.noteListFilterConfig.tagId = null
      this.noteListFilterConfig.isArchived = false
      this.noteListFilterConfig.withoutTag = false
      this.noteListFilterConfig.withLink = false
      this.noteListFilterConfig.withFile = false
      this.noteListFilterConfig.isRecycle = false
      this.noteListFilterConfig.startDate = null
      this.noteListFilterConfig.endDate = null
      this.noteListFilterConfig.isShare = null
      this.noteListFilterConfig.hasTodo = false

      if (path == 'notes') {
        this.noteListFilterConfig.type = NoteType.NOTE
        this.noteOnlyList.resetAndCall({});
      } else if (path == 'todo') {
        this.noteListFilterConfig.type = NoteType.TODO
        this.todoList.resetAndCall({});
      } else if (path == 'all') {
        this.noteListFilterConfig.type = -1
        this.noteList.resetAndCall({});
      } else if (path == 'archived') {
        this.noteListFilterConfig.type = -1
        this.noteListFilterConfig.isArchived = true
        this.archivedList.resetAndCall({});
      } else if (path == 'trash') {
        this.noteListFilterConfig.type = -1
        this.noteListFilterConfig.isRecycle = true
        this.trashList.resetAndCall({});
      } else {
        this.blinkoList.resetAndCall({});
      }

      if (tagId) {
        this.noteListFilterConfig.tagId = Number(tagId) as number
      }
      if (withoutTag) {
        this.noteListFilterConfig.withoutTag = true
      }
      if (withLink) {
        this.noteListFilterConfig.withLink = true
      }
      if (withFile) {
        this.noteListFilterConfig.withFile = true
      }
      if (hasTodo) {
        this.noteListFilterConfig.hasTodo = true
      }
      if (searchText) {
        this.searchText = searchText as string;
      } else {
        this.searchText = '';
      }
    }, [this.forceQuery, location.pathname, searchParams])
  }

  excludeEmbeddingTagId: number | null = null;

  setExcludeEmbeddingTagId(tagId: number | null) {
    this.excludeEmbeddingTagId = tagId;
  }

  settingsSearchText: string = '';

  constructor() {
    makeAutoObservable(this)
    eventBus.on('user:signout', () => {
      this.clear()
    })
  }

  removeCreateAttachments(file: { name: string, }) {
    this.createAttachmentsStorage.removeByFind(f => f.name === file.name);
    this.updateTicker++;
  }

  updateTagFilter(tagId: number) {
    this.noteListFilterConfig.tagId = tagId;
    this.noteListFilterConfig.type = -1
    this.noteList.resetAndCall({});
  }
}
