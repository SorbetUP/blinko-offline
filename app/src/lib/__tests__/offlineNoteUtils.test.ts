import { describe, expect, it } from 'bun:test';
import { mergeNotes, matchesOfflineFilters, sortNotes } from '../offlineNoteUtils';

const makeNote = (overrides: Partial<any> = {}) => ({
  id: overrides.id ?? 1,
  content: overrides.content ?? 'note',
  type: overrides.type ?? 0,
  isArchived: overrides.isArchived ?? false,
  isRecycle: overrides.isRecycle ?? false,
  isShare: overrides.isShare ?? false,
  isTop: overrides.isTop ?? false,
  sortOrder: overrides.sortOrder ?? 0,
  attachments: overrides.attachments ?? [],
  tags: overrides.tags ?? [],
  createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00Z'),
  updatedAt: overrides.updatedAt ?? new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('offlineNoteUtils', () => {
  it('mergeNotes prefers newer offline note content on id collision', () => {
    const server = [makeNote({ id: 10, content: 'server' })];
    const offline = [makeNote({ id: 10, content: 'offline', isOffline: true })];
    const merged = mergeNotes(offline as any, server as any);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe('offline');
  });

  it('matchesOfflineFilters respects flags and search', () => {
    const note = makeNote({
      id: 2,
      type: 1,
      isArchived: true,
      isShare: true,
      content: 'hello world',
      attachments: [{ path: 'file.pdf' }],
      tags: [{ tagId: 9 }],
    });

    const ok = matchesOfflineFilters(
      note as any,
      {
        type: 1,
        isArchived: true,
        isShare: true,
        tagId: 9,
        withFile: true,
        withLink: false,
      },
      'hello',
    );

    const notOk = matchesOfflineFilters(
      note as any,
      { type: 0, isArchived: false },
      'missing',
    );

    expect(ok).toBe(true);
    expect(notOk).toBe(false);
  });

  it('sortNotes prioritizes pinned then updated time', () => {
    const a = makeNote({ id: 1, updatedAt: new Date('2024-01-02T00:00:00Z') });
    const b = makeNote({ id: 2, updatedAt: new Date('2024-01-03T00:00:00Z') });
    const pinned = makeNote({ id: 3, isTop: true, updatedAt: new Date('2024-01-01T00:00:00Z') });

    const sorted = sortNotes([a, b, pinned] as any, { direction: 'desc' });
    expect(sorted[0]?.id).toBe(3);
    expect(sorted[1]?.id).toBe(2);
    expect(sorted[2]?.id).toBe(1);
  });
});
