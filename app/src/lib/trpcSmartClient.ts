import {
  createTRPCClient,
  httpBatchLink,
  httpBatchStreamLink,
  httpLink,
  splitLink,
  type TRPCLink,
} from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '../../../server/routerTrpc/_app';
import superjson from 'superjson';
import { getBlinkoEndpoint } from './blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { localNotesService } from './localNotesService';
import { initLocalDb } from './localDb';

const headers = () => {
  const userStore = RootStore.Get(UserStore);
  const token = userStore.token;
  const baseHeaders: Record<string, string> = {};
  if (token) baseHeaders['Authorization'] = `Bearer ${token}`;
  return baseHeaders;
};

const isNotesPath = (path: string) => path.startsWith('notes.');

type LinkOptions = {
  useStream?: boolean;
  baseUrl?: string;
  getHeaders?: () => Record<string, string>;
  fetchFn?: typeof fetch;
};

const buildLinks = (options: LinkOptions = {}) => {
  const useStream = options.useStream ?? false;
  const url = options.baseUrl ?? getBlinkoEndpoint('/api/trpc');
  const headerFn = options.getHeaders ?? headers;
  const fetchImpl = options.fetchFn ?? fetch;
  try {
    if (useStream) {
      return httpBatchStreamLink({
        url,
        transformer: superjson,
        headers: headerFn,
        fetch(url, options) {
          return fetchImpl(url, {
            ...options,
            signal: AbortSignal.timeout(5 * 60 * 1000),
          });
        },
      });
    }

    return splitLink({
      condition(op) {
        return op.context.skipBatch === true;
      },
      true: httpLink({
        url,
        transformer: superjson,
        headers: headerFn,
        fetch(url, options) {
          return fetchImpl(url, {
            ...options,
            signal: AbortSignal.timeout(5 * 60 * 1000),
          });
        },
      }),
      false: httpBatchLink({
        url,
        transformer: superjson,
        headers: headerFn,
        fetch(url, options) {
          return fetchImpl(url, {
            ...options,
            signal: AbortSignal.timeout(5 * 60 * 1000),
          });
        },
      }),
    });
  } catch (error) {
    console.error(error, 'trpc get links error');
    return splitLink({
      condition(op) {
        return op.context.skipBatch === true;
      },
      true: httpLink({
        url: '/api/trpc',
        transformer: superjson,
        headers: headerFn,
        fetch(url, options) {
          return fetchImpl(url, {
            ...options,
            signal: AbortSignal.timeout(5 * 60 * 1000),
          });
        },
      }),
      false: httpBatchLink({
        url: '/api/trpc',
        transformer: superjson,
        headers: headerFn,
        fetch(url, options) {
          return fetchImpl(url, {
            ...options,
            signal: AbortSignal.timeout(5 * 60 * 1000),
          });
        },
      }),
    });
  }
};

const handleLocalNotes = async (path: string, input: unknown) => {
  await initLocalDb();
  if (path === 'notes.list') return await localNotesService.list(input as any);
  if (path === 'notes.detail') return await localNotesService.detail(input as any);
  if (path === 'notes.listByIds') return await localNotesService.listByIds(input as any);
  if (path === 'notes.dailyReviewNoteList') return await localNotesService.list({ page: 1, size: 30 });
  if (path === 'notes.randomNoteList') return await localNotesService.list({ page: 1, size: 30 });
  if (path === 'notes.upsert') return await localNotesService.upsert(input as any);
  throw new Error(`local notes unsupported op: ${path}`);
};

const notesSmartLink: TRPCLink<AppRouter> = () => ({ op, next }) => {
  return observable((observer) => {
    if (!isNotesPath(op.path)) {
      return next(op).subscribe(observer);
    }

    (async () => {
      try {
        const localData = await handleLocalNotes(op.path, op.input);
        observer.next({ result: { data: localData } } as any);
        observer.complete();
      } catch (error) {
        observer.error(error as any);
      }
    })();

    return () => {};
  });
};

export const createRemoteClient = (options: LinkOptions = {}) =>
  createTRPCClient<AppRouter>({
    links: [buildLinks(options)],
  });

export const createSmartClient = () =>
  createTRPCClient<AppRouter>({
    links: [notesSmartLink, buildLinks({ useStream: false })],
  });
