import type { Note } from '../lib/types';

export const normalizeNoteTime = (value?: Date | string | null) => {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const mergeNotes = (offlineNotes: Note[], notes: Note[]) => {
  const noteMap = new Map<number, Note>();
  notes.forEach((note) => {
    if (!note?.id) return;
    noteMap.set(note.id, { ...note, isExpand: false });
  });
  offlineNotes.forEach((note) => {
    if (!note?.id) return;
    noteMap.set(note.id, { ...note, isExpand: false });
  });
  return [...noteMap.values()];
};

export const matchesOfflineFilters = (note: Note, filterConfig: any, searchText: string) => {
  if (filterConfig?.type !== undefined && filterConfig.type !== -1 && note.type !== filterConfig.type) {
    return false;
  }
  if (
    filterConfig?.isArchived !== null &&
    filterConfig?.isArchived !== undefined &&
    note.isArchived !== filterConfig.isArchived
  ) {
    return false;
  }
  if (
    filterConfig?.isRecycle !== null &&
    filterConfig?.isRecycle !== undefined &&
    note.isRecycle !== filterConfig.isRecycle
  ) {
    return false;
  }
  if (filterConfig?.isShare !== null && filterConfig?.isShare !== undefined && note.isShare !== filterConfig.isShare) {
    return false;
  }
  if (filterConfig?.tagId) {
    const tagId = Number(filterConfig.tagId);
    const hasTag = note.tags?.some((tag) => tag.tagId === tagId || tag.tag?.id === tagId);
    if (!hasTag) return false;
  }
  if (filterConfig?.withoutTag && (note.tags?.length ?? 0) > 0) {
    return false;
  }
  if (filterConfig?.withFile && (note.attachments?.length ?? 0) === 0) {
    return false;
  }
  if (filterConfig?.withLink) {
    const content = note.content ?? '';
    if (!content.includes('http://') && !content.includes('https://')) {
      return false;
    }
  }
  if (filterConfig?.hasTodo) {
    const content = note.content ?? '';
    const hasTodo =
      content.includes('- [ ]') ||
      content.includes('- [x]') ||
      content.includes('* [ ]') ||
      content.includes('* [x]');
    if (!hasTodo) {
      return false;
    }
  }
  if (filterConfig?.startDate && filterConfig?.endDate) {
    const createdAt = normalizeNoteTime(note.createdAt);
    const start = normalizeNoteTime(filterConfig.startDate);
    const end = normalizeNoteTime(filterConfig.endDate);
    if (createdAt < start || createdAt > end) {
      return false;
    }
  }
  const normalizedSearch = searchText?.trim().toLowerCase();
  if (normalizedSearch) {
    const content = (note.content ?? '').toLowerCase();
    const attachmentMatch = note.attachments?.some((attachment) =>
      (attachment?.path ?? '').toLowerCase().includes(normalizedSearch),
    );
    if (!content.includes(normalizedSearch) && !attachmentMatch) {
      return false;
    }
  }
  return true;
};

export const sortNotes = (notes: Note[], options: { direction?: 'asc' | 'desc'; useCreatedAt?: boolean } = {}) => {
  const { direction = 'desc', useCreatedAt = false } = options;
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...notes].sort((a, b) => {
    const topDiff = Number(Boolean(b.isTop)) - Number(Boolean(a.isTop));
    if (topDiff !== 0) return topDiff;

    const orderA = a.sortOrder ?? 0;
    const orderB = b.sortOrder ?? 0;
    if (orderA !== orderB) return orderA - orderB;

    const timeA = normalizeNoteTime(useCreatedAt ? a.createdAt : a.updatedAt);
    const timeB = normalizeNoteTime(useCreatedAt ? b.createdAt : b.updatedAt);
    return (timeA - timeB) * multiplier;
  });
};
