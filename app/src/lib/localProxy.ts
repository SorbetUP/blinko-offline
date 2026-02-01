import axios from 'axios';
import superjson from 'superjson';
import { BaseStore } from '@/store/baseStore';
import { RootStore } from '@/store';
import { getRemoteEndpoint } from './blinkoEndpoint';
import { getCachedTrpc, initLocalDb, setCachedTrpc, countLocalUsers, createLocalUser, deleteLocalUser, getLocalUserById, getLocalUserAuthRecord, getLocalUserAuthRecordById, listLocalUsers, updateLocalUser, updateLocalUserToken } from './localDb';
import { localNotesService } from './localNotesService';
import { generateLocalToken, hashPassword, verifyPassword } from './localAuth';
import { getSyncEnabled, getSyncEndpoint, setSyncEnabled, setSyncEndpoint } from './syncConfig';
import { ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME } from '@shared/lib/sharedConstant';

let installed = false;

const isInTauri = () => {
  try {
    return typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined;
  } catch {
    return false;
  }
};

const normalizeBaseUrl = (raw?: string) => {
  const cleaned = (raw || '').replace(/\"/g, '').trim();
  if (!cleaned) return '';
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned);
  const withScheme = hasScheme ? cleaned : `http://${cleaned}`;
  try {
    return new URL(withScheme).toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

const safeResolveUrl = (rawUrl?: string, rawBase?: string) => {
  const base = rawBase || window.location.origin;
  try {
    return new URL(rawUrl || '', base).toString();
  } catch {
    const normalized = normalizeBaseUrl(base);
    try {
      return new URL(rawUrl || '', normalized || window.location.origin).toString();
    } catch {
      return normalized || window.location.origin;
    }
  }
};

const safeNewUrl = (raw?: string, base?: string, label?: string) => {
  const baseValue = base || window.location.origin;
  try {
    return new URL(raw || '', baseValue);
  } catch (error) {
    const normalizedBase = normalizeBaseUrl(baseValue) || window.location.origin;
    console.error(`[localProxy] URL parse failed${label ? ` (${label})` : ''}`, {
      raw,
      base: baseValue,
      normalizedBase,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      return new URL(raw || '', normalizedBase);
    } catch (error2) {
      console.error(`[localProxy] URL parse fallback failed${label ? ` (${label})` : ''}`, {
        raw,
        base: normalizedBase,
        error: error2 instanceof Error ? error2.message : String(error2),
      });
      return new URL(window.location.origin);
    }
  }
};

const isNotesPath = (path: string) => path.startsWith('notes.');

const decodeInput = async (request: Request) => {
  const url = safeNewUrl(request.url, window.location.origin, 'decodeInput');
  const rawInputParam = url.searchParams.get('input');

  if (request.method !== 'GET') {
    const bodyText = await request.text();
    if (!bodyText) return undefined;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed === 'object' && 'json' in parsed && 'meta' in parsed) {
        return superjson.deserialize(parsed as any);
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  if (!rawInputParam) return undefined;
  try {
    const parsed = JSON.parse(rawInputParam);
    if (parsed && typeof parsed === 'object' && 'json' in parsed && 'meta' in parsed) {
      return superjson.deserialize(parsed as any);
    }
    return parsed;
  } catch {
    return undefined;
  }
};

const buildTrpcResponse = (data: unknown) => {
  const serialized = superjson.serialize(data);
  return new Response(
    JSON.stringify({ result: { data: serialized } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

const buildTrpcError = (message: string, status = 500) => {
  return new Response(
    JSON.stringify({
      error: {
        code: -32603,
        message,
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          httpStatus: status,
        },
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
};

const LOCAL_FILE_ROOT = 'blinko_files';
const LOCAL_S3_ROOT = 'blinko_s3files';
const LOCAL_PLUGIN_ROOT = 'blinko_plugins';

const decodePath = (raw: string) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const sanitizePath = (raw: string) => {
  const decoded = decodePath(raw);
  return decoded.replace(/^\/+/, '').replace(/(\.\.[/\\])+/g, '').replace(/\\/g, '/');
};

const guessContentType = (path: string) => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.js')) return 'application/javascript';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
};

const loadFs = async () => {
  const mod = await import('@tauri-apps/plugin-fs');
  return {
    BaseDirectory: mod.BaseDirectory,
    readFile: mod.readFile,
    writeFile: mod.writeFile,
    mkdir: mod.mkdir,
    exists: mod.exists,
    remove: mod.remove,
    rename: mod.rename,
    readDir: mod.readDir,
  };
};

const ensureDir = async (path: string, baseDir: any) => {
  const { mkdir, exists } = await loadFs();
  const present = await exists(path, { baseDir });
  if (!present) {
    await mkdir(path, { baseDir, recursive: true });
  }
};

const readLocalFile = async (root: string, relPath: string) => {
  const { BaseDirectory, readFile, exists } = await loadFs();
  const sanitized = sanitizePath(relPath);
  const full = `${root}/${sanitized}`;
  const present = await exists(full, { baseDir: BaseDirectory.AppData });
  if (!present) return null;
  const data = await readFile(full, { baseDir: BaseDirectory.AppData });
  return { data, path: full };
};

const writeLocalFile = async (root: string, relPath: string, data: Uint8Array) => {
  const { BaseDirectory, writeFile } = await loadFs();
  await ensureDir(root, BaseDirectory.AppData);
  const sanitized = sanitizePath(relPath);
  const full = `${root}/${sanitized}`;
  await writeFile(full, data, { baseDir: BaseDirectory.AppData });
  return full;
};

const getParentPath = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
};

const removeLocalFile = async (root: string, relPath: string, recursive = false) => {
  const { BaseDirectory, remove, exists } = await loadFs();
  const sanitized = sanitizePath(relPath);
  const full = `${root}/${sanitized}`;
  const present = await exists(full, { baseDir: BaseDirectory.AppData });
  if (present) {
    await remove(full, { baseDir: BaseDirectory.AppData, recursive });
  }
};

const moveLocalPath = async (root: string, fromRel: string, toRel: string) => {
  const { BaseDirectory, rename, exists } = await loadFs();
  const fromSanitized = sanitizePath(fromRel);
  const toSanitized = sanitizePath(toRel);
  const from = `${root}/${fromSanitized}`;
  const to = `${root}/${toSanitized}`;
  const present = await exists(from, { baseDir: BaseDirectory.AppData });
  if (!present) return;
  const targetDir = getParentPath(toSanitized);
  if (targetDir) {
    await ensureDir(`${root}/${targetDir}`, BaseDirectory.AppData);
  } else {
    await ensureDir(root, BaseDirectory.AppData);
  }
  await rename(from, to, {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  });
};

const fetchAndCacheFile = async (request: Request, root: string, relPath: string) => {
  try {
    const proxiedRequest = new Request(toRemoteUrl(request), request);
    const rawFetch = (globalThis as any).__BLINKO_RAW_FETCH || fetch;
    const response = await fetchWithTimeout(rawFetch, proxiedRequest, 8000);
    if (!response.ok) return response;
    const buffer = new Uint8Array(await response.arrayBuffer());
    await writeLocalFile(root, relPath, buffer);
    const contentType = response.headers.get('content-type') || guessContentType(relPath);
    return new Response(buffer, { status: response.status, headers: { 'content-type': contentType } });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
};

const fetchWithTimeout = async (realFetch: typeof fetch, request: Request, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await realFetch(new Request(request, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
};

const normalizeRemoteBase = (endpoint: string) => {
  const cleaned = endpoint.replace(/\/api\/trpc\/?$/i, '').replace(/\/+$/, '');
  return cleaned || endpoint;
};

const getRemoteBase = () => {
  const syncEndpoint = getSyncEndpoint();
  if (syncEndpoint) return normalizeRemoteBase(syncEndpoint);
  return normalizeRemoteBase(getRemoteEndpoint(''));
};

const toRemoteUrl = (input: RequestInfo | URL | string) => {
  const raw = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
  const url = safeNewUrl(raw, window.location.origin, 'parseEndpointRaw');
  const remoteBase = getRemoteBase();
  const remoteBaseUrl = safeNewUrl(remoteBase, window.location.origin, 'remoteBaseUrl');

  if (url.origin === window.location.origin || url.origin === remoteBaseUrl.origin) {
    const remote = safeNewUrl(url.pathname + url.search, remoteBaseUrl.toString(), 'remoteUrl');
    return remote.toString();
  }

  return url.toString();
};

const isRemoteRequest = (url: URL) => {
  try {
    const remoteBase = getRemoteBase();
    const remoteBaseUrl = safeNewUrl(remoteBase, window.location.origin, 'remoteBaseUrl2');
    return url.origin === remoteBaseUrl.origin;
  } catch {
    return false;
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
  if (path === 'notes.addReference') return true;
  if (path === 'notes.clearRecycleBin') return true;
  if (path === 'notes.deleteMany') return true;
  if (path === 'notes.getInternalSharedUsers') return [];
  if (path === 'notes.getNoteHistory') return [];
  if (path === 'notes.getNoteVersion') return null;
  if (path === 'notes.internalShareNote') return true;
  if (path === 'notes.internalSharedWithMe') return [];
  if (path === 'notes.noteReferenceList') return [];
  if (path === 'notes.publicDetail') return null;
  if (path === 'notes.publicList') return [];
  if (path === 'notes.relatedNotes') return [];
  if (path === 'notes.reviewNote') return true;
  if (path === 'notes.shareNote') return true;
  if (path === 'notes.trashMany') return true;
  if (path === 'notes.updateAttachmentsOrder') return true;
  if (path === 'notes.updateMany') return true;
  if (path === 'notes.updateNotesOrder') return true;
  return guessFallback(path);
};

const makeCacheKey = (path: string, input: unknown) => {
  const serialized = superjson.serialize(input);
  const userId = (getUserSnapshot() as any)?.user?.id;
  const scope = userId ? `user:${String(userId)}` : 'global';
  return `${scope}::${path}::${JSON.stringify(serialized)}`;
};

const makeListKey = (path: string) => makeCacheKey(path, {});

const getOrInitCached = async <T>(path: string, input: unknown, fallback: T): Promise<T> => {
  const key = makeCacheKey(path, input);
  const cached = await getCachedTrpc<T>(key);
  if (cached !== null) return cached;
  await setCachedTrpc(key, fallback as unknown);
  return fallback;
};

const getListCache = async <T>(path: string, fallback: T): Promise<T> => {
  const key = makeListKey(path);
  const cached = await getCachedTrpc<T>(key);
  if (cached !== null) return cached;
  await setCachedTrpc(key, fallback as unknown);
  return fallback;
};

const setListCache = async (path: string, value: unknown) => {
  const key = makeListKey(path);
  await setCachedTrpc(key, value);
};

const getPluginConfigKey = (pluginName: string) => {
  return makeCacheKey('config.getPluginConfig', { pluginName });
};

const getPluginConfig = async (pluginName: string) => {
  const key = getPluginConfigKey(pluginName);
  const cached = await getCachedTrpc<Record<string, any>>(key);
  if (cached !== null) return cached;
  await setCachedTrpc(key, {});
  return {};
};

const setPluginConfig = async (pluginName: string, config: Record<string, any>) => {
  const key = getPluginConfigKey(pluginName);
  await setCachedTrpc(key, config);
};

const listCssFilesLocal = async (baseDir: any, root: string): Promise<string[]> => {
  const { readDir } = await loadFs();
  let entries: any[] = [];
  try {
    entries = await readDir(root, { baseDir });
  } catch {
    return [];
  }
  const results: string[] = [];
  for (const entry of entries) {
    const entryPath = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      const nested = await listCssFilesLocal(baseDir, entryPath);
      results.push(...nested.map((item) => `${entry.name}/${item}`));
    } else if (entry.isFile && entry.name.endsWith('.css')) {
      results.push(entry.name);
    }
  }
  return results;
};

const addAttachmentCacheEntry = async (entry: any) => {
  const list = (await getListCache('attachments.list', [])) as any[];
  const next = [entry, ...(list ?? [])];
  await setListCache('attachments.list', next);
};

const updateListItemById = <T extends { id?: number | string }>(list: T[], id: number | string, patch: Partial<T>) => {
  let found = false;
  const next = list.map((item) => {
    if (String(item?.id) === String(id)) {
      found = true;
      return { ...item, ...patch };
    }
    return item;
  });
  return { next, found };
};

const removeListItemById = <T extends { id?: number | string }>(list: T[], id: number | string) => {
  return list.filter((item) => String(item?.id) !== String(id));
};

const guessFallback = (path: string) => {
  if (/list$/i.test(path) || /list/i.test(path)) return [];
  if (/count$/i.test(path)) return 0;
  if (/detail$/i.test(path)) return null;
  if (/create|update|delete|toggle|mark/i.test(path)) return true;
  return null;
};

const getAttachmentRelPath = (path: string) => {
  if (!path) return '';
  if (path.startsWith('/api/file/')) return stripFileApiPrefix(path);
  if (path.startsWith('/api/s3file/')) return sanitizePath(path.replace(/^\/api\/s3file\//, ''));
  return '';
};

const buildFolderEntry = (folderRel: string) => {
  const now = new Date().toISOString();
  const name = folderRel.split('/').filter(Boolean).pop() || folderRel;
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    path: buildFileApiPath(folderRel, true),
    name,
    size: null,
    type: 'folder',
    isShare: false,
    sharePassword: '',
    noteId: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    isFolder: true,
    folderName: name,
  };
};

const encodePathSegments = (path: string) => {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
};

const stripFileApiPrefix = (path: string) => {
  return sanitizePath(path.replace(/^\/api\/file\//, ''));
};

const normalizeFolderRel = (path: string) => {
  const rel = stripFileApiPrefix(path);
  return rel.replace(/\/$/, '');
};

const buildFileApiPath = (relPath: string, isFolder = false) => {
  const encoded = encodePathSegments(relPath);
  return `/api/file/${encoded}${isFolder ? '/' : ''}`;
};

const replacePathPrefix = (path: string, oldRel: string, newRel: string) => {
  const oldEncoded = encodePathSegments(oldRel);
  const newEncoded = encodePathSegments(newRel);
  const oldPrefixEncoded = `/api/file/${oldEncoded}/`;
  const newPrefixEncoded = `/api/file/${newEncoded}/`;
  const oldPrefixRaw = `/api/file/${oldRel.replace(/\/$/, '')}/`;
  const newPrefixRaw = `/api/file/${newRel.replace(/\/$/, '')}/`;

  if (path.startsWith(oldPrefixEncoded)) {
    return path.replace(oldPrefixEncoded, newPrefixEncoded);
  }
  if (path.startsWith(oldPrefixRaw)) {
    return path.replace(oldPrefixRaw, newPrefixRaw);
  }
  return path;
};

const getUserSnapshot = () => {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem('blinkoToken');
    if (!raw) return {};
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
};

const ensureLocalAuth = async () => {
  try {
    await initLocalDb();
    const snapshot: any = getUserSnapshot();
    if (snapshot?.token && snapshot?.user?.id) return;
    const users = await listLocalUsers();
    if (!users.length) return;
    const user = users[0];
    const tokenData = {
      token: user.token || generateLocalToken(),
      user: {
        id: Number(user.id),
        name: String(user.name ?? ''),
        nickname: String(user.nickname ?? user.name ?? ''),
        role: String(user.role ?? 'user'),
        image: user.image ?? null,
      },
    };
    window.localStorage.setItem('blinkoToken', JSON.stringify(tokenData));
  } catch {
    // ignore
  }
};

const readJsonBody = async (request: Request) => {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const queryParamsToObject = (url: URL) => {
  const obj: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
};

const mapV1ToTrpc = (pathname: string) => {
  const map: Record<string, string> = {
    '/api/v1/config/list': 'config.list',
    '/api/v1/config/update': 'config.update',
    '/api/v1/config/getPluginConfig': 'config.getPluginConfig',
    '/api/v1/config/setPluginConfig': 'config.setPluginConfig',
    '/api/v1/tags/list': 'tags.list',
    '/api/v1/tags/batch-update': 'tags.updateTagMany',
    '/api/v1/tags/update-name': 'tags.updateTagName',
    '/api/v1/tags/update-icon': 'tags.updateTagIcon',
    '/api/v1/tags/update-order': 'tags.updateTagOrder',
    '/api/v1/tags/delete-only-tag': 'tags.deleteOnlyTag',
    '/api/v1/tags/delete-tag-with-notes': 'tags.deleteTagWithAllNote',
    '/api/v1/notification/list': 'notifications.list',
    '/api/v1/notification/create': 'notifications.create',
    '/api/v1/notification/unread-count': 'notifications.unreadCount',
    '/api/v1/notification/unreadCount': 'notifications.unreadCount',
    '/api/v1/notification/mark-as-read': 'notifications.markAsRead',
    '/api/v1/notification/delete': 'notifications.delete',
    '/api/v1/attachment/list': 'attachments.list',
    '/api/v1/attachment/create-folder': 'attachments.createFolder',
    '/api/v1/attachment/rename': 'attachments.rename',
    '/api/v1/attachment/move': 'attachments.move',
    '/api/v1/attachment/delete': 'attachments.delete',
    '/api/v1/attachment/delete-many': 'attachments.deleteMany',
    '/api/v1/plugin/list': 'plugin.getInstalledPlugins',
    '/api/v1/plugin/css': 'plugin.getPluginCssContents',
    '/api/v1/plugin/install': 'plugin.installPlugin',
    '/api/v1/plugin/uninstall': 'plugin.uninstallPlugin',
    '/api/v1/task/list': 'task.list',
    '/api/v1/task/upsert': 'task.upsertTask',
    '/api/v1/task/export-markdown': 'task.exportMarkdown',
    '/api/v1/font/list': 'fonts.list',
    '/api/v1/font/data': 'fonts.getFontData',
    '/api/v1/font/get': 'fonts.getByName',
    '/api/v1/font/create': 'fonts.create',
    '/api/v1/font/update': 'fonts.update',
    '/api/v1/font/delete': 'fonts.delete',
    '/api/v1/font/upload': 'fonts.upload',
    '/api/v1/user/list': 'users.list',
    '/api/v1/user/detail': 'users.detail',
    '/api/v1/user/public-user-list': 'users.publicUserList',
    '/api/v1/user/native-account-list': 'users.nativeAccountList',
    '/api/v1/user/can-register': 'users.canRegister',
    '/api/v1/user/register': 'users.register',
    '/api/v1/note/public-list': 'notes.publicList',
    '/api/v1/note/public-detail': 'notes.publicDetail',
    '/api/v1/comment/list': 'comments.list',
  };
  return map[pathname] || null;
};

const fallbackForPath = (path: string) => {
  const tokenData: any = getUserSnapshot();
  const userData = tokenData?.user ?? {};
  if (path === 'config.list') return {};
  if (path === 'config.ai') return {};
  if (path === 'tags.list') return [];
  if (path === 'notifications.list') return [];
  if (path === 'notifications.unreadCount') return 0;
  if (path === 'plugin.getInstalledPlugins') return [];
  if (path === 'plugin.getAllPlugins') return [];
  if (path === 'plugin.getPluginCssContents') return '';
  if (path === 'task.list') return [];
  if (path === 'users.list') return [];
  if (path === 'users.canRegister') return false;
  if (path === 'fonts.list') return [];
  if (path === 'users.detail') {
    return {
      id: Number(userData.id) || 0,
      name: userData.name || '',
      nickname: userData.nickname || '',
      image: userData.image || '',
      role: userData.role || '',
    };
  }
  return guessFallback(path);
};

const handleLocalTrpc = async (path: string, input: unknown) => {
  await initLocalDb();

  if (isNotesPath(path)) {
    return await handleLocalNotes(path, input);
  }

  if (path === 'config.list') {
    const current = (await getListCache(path, {})) as Record<string, any>;
    const syncEndpoint = getSyncEndpoint();
    const syncEnabled = getSyncEnabled();
    if (syncEndpoint && current.syncEndpoint !== syncEndpoint) {
      current.syncEndpoint = syncEndpoint;
    }
    if (typeof current.syncEnabled === 'undefined') {
      current.syncEnabled = syncEnabled;
    }
    await setListCache('config.list', current);
    return current;
  }
  if (path === 'config.update') {
    const current = (await getListCache('config.list', {})) as Record<string, any>;
    const payload = (input as any) ?? {};
    let next = { ...current };
    if ('key' in payload && 'value' in payload) {
      next[payload.key] = payload.value;
      if (payload.key === 'syncEnabled') {
        setSyncEnabled(Boolean(payload.value));
      }
      if (payload.key === 'syncEndpoint') {
        setSyncEndpoint(String(payload.value || ''));
      }
    } else {
      next = { ...next, ...payload };
    }
    await setListCache('config.list', next);
    return next;
  }
  if (path === 'config.ai') {
    return await getListCache(path, null);
  }
  if (path === 'config.getPluginConfig') {
    const pluginName = String((input as any)?.pluginName ?? '').trim();
    if (!pluginName) return {};
    return await getPluginConfig(pluginName);
  }
  if (path === 'config.setPluginConfig') {
    const payload = (input as any) ?? {};
    const pluginName = String(payload?.pluginName ?? '').trim();
    if (!pluginName) return true;
    const current = await getPluginConfig(pluginName);
    if (payload.key) {
      current[payload.key] = payload.value;
      await setPluginConfig(pluginName, current);
      return true;
    }
    if (payload.config && typeof payload.config === 'object') {
      await setPluginConfig(pluginName, payload.config);
      return true;
    }
    await setPluginConfig(pluginName, current);
    return true;
  }

  if (path === 'tags.list') {
    return await getListCache(path, []);
  }
  if (path === 'tags.fullTagNameById') {
    const tags = (await getListCache('tags.list', [])) as any[];
    const id = (input as any)?.id;
    const map = new Map(tags.map((t) => [String(t.id), t]));
    let current = map.get(String(id));
    if (!current) return '';
    const names = [current.name];
    while (current?.parent && current.parent !== 0) {
      current = map.get(String(current.parent));
      if (!current) break;
      names.unshift(current.name);
    }
    return `#${names.join('/')}`;
  }
  if (path === 'tags.updateTagIcon') {
    const tags = (await getListCache('tags.list', [])) as any[];
    const { id, icon } = (input as any) ?? {};
    const { next } = updateListItemById(tags, id, { icon });
    await setListCache('tags.list', next);
    return next.find((t) => String(t.id) === String(id)) ?? null;
  }
  if (path === 'tags.updateTagName') {
    const tags = (await getListCache('tags.list', [])) as any[];
    const { id, newName } = (input as any) ?? {};
    const { next } = updateListItemById(tags, id, { name: newName });
    await setListCache('tags.list', next);
    return true;
  }
  if (path === 'tags.updateTagOrder') {
    const tags = (await getListCache('tags.list', [])) as any[];
    const { id, sortOrder } = (input as any) ?? {};
    const { next } = updateListItemById(tags, id, { sortOrder });
    await setListCache('tags.list', next);
    return true;
  }
  if (path === 'tags.deleteOnlyTag' || path === 'tags.deleteTagWithAllNote') {
    const tags = (await getListCache('tags.list', [])) as any[];
    const { id } = (input as any) ?? {};
    const next = removeListItemById(tags, id);
    await setListCache('tags.list', next);
    return true;
  }
  if (path === 'tags.updateTagMany') {
    const payload = (input as any) ?? {};
    const rawTag = String(payload.tag ?? '').trim();
    if (!rawTag) return true;
    const namePath = rawTag.replace(/^#/, '');
    const segments = namePath.split('/').map((seg: string) => seg.trim()).filter(Boolean);
    if (!segments.length) return true;
    const tags = (await getListCache('tags.list', [])) as any[];
    let parent = 0;
    const now = new Date().toISOString();
    for (const segment of segments) {
      let existing = tags.find((tag) => String(tag.name) === segment && Number(tag.parent ?? 0) === parent);
      if (!existing) {
        const nextId = Date.now() + Math.floor(Math.random() * 1000);
        existing = {
          id: nextId,
          name: segment,
          parent,
          sortOrder: tags.length,
          icon: '',
          createdAt: now,
          updatedAt: now,
        };
        tags.push(existing);
      }
      parent = Number(existing.id);
    }
    await setListCache('tags.list', tags);
    return true;
  }

  if (path === 'notifications.list') {
    const payload = (input as any) ?? {};
    const page = Number(payload.page ?? 1);
    const size = Number(payload.size ?? 30);
    const list = (await getListCache(path, [])) as any[];
    const start = (page - 1) * size;
    return list.slice(start, start + size);
  }
  if (path === 'notifications.unreadCount') {
    const list = (await getListCache('notifications.list', [])) as any[];
    return list.filter((item) => !item.isRead).length;
  }
  if (path === 'notifications.create') {
    const list = (await getListCache('notifications.list', [])) as any[];
    const payload = (input as any) ?? {};
    const id = Number(payload?.id ?? Date.now());
    const entry = {
      id,
      ...payload,
      isRead: false,
      createdAt: payload?.createdAt ?? new Date().toISOString(),
      updatedAt: payload?.updatedAt ?? new Date().toISOString(),
    };
    const next = [entry, ...list];
    await setListCache('notifications.list', next);
    return true;
  }
  if (path === 'notifications.markAsRead') {
    const list = (await getListCache('notifications.list', [])) as any[];
    const { id, all } = (input as any) ?? {};
    const next = list.map((item) => {
      if (all) return { ...item, isRead: true };
      if (id && String(item.id) === String(id)) return { ...item, isRead: true };
      return item;
    });
    await setListCache('notifications.list', next);
    return true;
  }
  if (path === 'notifications.delete') {
    const list = (await getListCache('notifications.list', [])) as any[];
    const { id } = (input as any) ?? {};
    const next = removeListItemById(list, id);
    await setListCache('notifications.list', next);
    return true;
  }

  if (path === 'plugin.getInstalledPlugins' || path === 'plugin.getAllPlugins') {
    if (path === 'plugin.getInstalledPlugins') {
      return await getListCache('plugin.getInstalledPlugins', []);
    }
    const installed = await getListCache('plugin.getInstalledPlugins', []);
    return await getListCache('plugin.getAllPlugins', installed);
  }
  if (path === 'plugin.getPluginCssContents') {
    const pluginName = String((input as any)?.pluginName ?? '').trim();
    if (!pluginName) return [];
    const { BaseDirectory, readFile } = await loadFs();
    const root = `${LOCAL_PLUGIN_ROOT}/${sanitizePath(pluginName)}`;
    const cssFiles = await listCssFilesLocal(BaseDirectory.AppData, root);
    const decoder = new TextDecoder();
    const result: Array<{ fileName: string; content: string }> = [];
    for (const fileName of cssFiles) {
      try {
        const data = await readFile(`${root}/${fileName}`, { baseDir: BaseDirectory.AppData });
        result.push({ fileName, content: decoder.decode(data) });
      } catch {
        // ignore missing file
      }
    }
    return result;
  }
  if (path === 'plugin.saveDevPlugin') {
    const payload = (input as any) ?? {};
    const fileName = String(payload?.fileName ?? 'index.js');
    const code = String(payload?.code ?? '');
    const metadata = payload?.metadata ?? { name: 'dev' };
    if (code) {
      await writeLocalFile(LOCAL_PLUGIN_ROOT, `dev/${fileName}`, new TextEncoder().encode(code));
    }
    const list = (await getListCache('plugin.getInstalledPlugins', [])) as any[];
    const now = new Date().toISOString();
    const existing = list.find((item) => String(item?.path ?? '') === '/plugins/dev/index.js' || String(item?.metadata?.name ?? '') === 'dev');
    const entry = {
      id: existing?.id ?? Date.now(),
      metadata: metadata ?? { name: 'dev' },
      path: '/plugins/dev/index.js',
      isUse: true,
      isDev: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = existing ? list.map((item) => (String(item?.id) === String(existing.id) ? entry : item)) : [entry, ...list];
    await setListCache('plugin.getInstalledPlugins', next);
    return { success: true };
  }
  if (path === 'plugin.saveAdditionalDevFile') {
    const payload = (input as any) ?? {};
    const filePath = String(payload?.filePath ?? '').trim();
    const content = String(payload?.content ?? '');
    if (!filePath) return { success: false };
    await writeLocalFile(LOCAL_PLUGIN_ROOT, `dev/${filePath}`, new TextEncoder().encode(content));
    return { success: true };
  }
  if (path === 'plugin.installPlugin') {
    const payload = (input as any) ?? {};
    const name = String(payload?.name ?? '').trim();
    if (!name) return true;
    const list = (await getListCache('plugin.getInstalledPlugins', [])) as any[];
    const now = new Date().toISOString();
    const existing = list.find((item) => String(item?.metadata?.name ?? '') === name);
    const entry = {
      id: existing?.id ?? Date.now(),
      metadata: payload,
      path: `/plugins/${name}/index.js`,
      isUse: true,
      isDev: false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = existing ? list.map((item) => (String(item?.id) === String(existing.id) ? entry : item)) : [entry, ...list];
    await setListCache('plugin.getInstalledPlugins', next);
    return entry;
  }
  if (path === 'plugin.uninstallPlugin') {
    const payload = (input as any) ?? {};
    const id = String(payload?.id ?? '');
    if (!id) return { success: true };
    const list = (await getListCache('plugin.getInstalledPlugins', [])) as any[];
    const next = list.filter((item) => String(item?.id) !== id);
    await setListCache('plugin.getInstalledPlugins', next);
    return { success: true };
  }
  if (path.startsWith('plugin.')) {
    return true;
  }

  if (path === 'task.list') {
    const list = (await getListCache('task.list', [])) as any[];
    if (list.length) return list;
    const now = new Date().toISOString();
    const defaults = [
      {
        name: DBBAK_TASK_NAME,
        schedule: '0 0 * * *',
        lastRun: null,
        isRunning: false,
        output: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: ARCHIVE_BLINKO_TASK_NAME,
        schedule: '0 0 * * *',
        lastRun: null,
        isRunning: false,
        output: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    await setListCache('task.list', defaults);
    return defaults;
  }
  if (path === 'task.upsertTask') {
    const payload = (input as any) ?? {};
    const type = String(payload?.type ?? '');
    const taskName = String(payload?.task ?? '');
    const time = payload?.time ?? '0 0 * * *';
    const list = (await getListCache('task.list', [])) as any[];
    const now = new Date().toISOString();
    const existing = list.find((item) => String(item?.name ?? '') === taskName);
    const nextItem = existing ?? {
      name: taskName,
      schedule: String(time),
      lastRun: null,
      isRunning: false,
      output: null,
      createdAt: now,
      updatedAt: now,
    };
    if (type === 'start') {
      nextItem.isRunning = true;
      nextItem.schedule = String(time);
    } else if (type === 'stop') {
      nextItem.isRunning = false;
    } else if (type === 'update') {
      nextItem.schedule = String(time);
    }
    nextItem.updatedAt = now;
    const next = existing ? list.map((item) => (String(item?.name ?? '') === taskName ? nextItem : item)) : [nextItem, ...list];
    await setListCache('task.list', next);
    return { success: true, action: type || 'updated', cron: String(time) };
  }
  if (path === 'task.exportMarkdown') {
    return { success: false, error: 'offline' };
  }
  if (path.startsWith('task.importFrom')) {
    return [{ type: 'error', content: 'offline' }];
  }
  if (path.startsWith('task.')) {
    return true;
  }

  if (path === 'fonts.list') {
    const payload = (input as any) ?? {};
    const category = String(payload?.category ?? '').trim();
    const list = (await getListCache('fonts.list', [])) as any[];
    if (!category) return list;
    return list.filter((font) => String(font?.category ?? '') === category);
  }
  if (path === 'fonts.getFontData') {
    const name = String((input as any)?.name ?? '').trim();
    const list = (await getListCache('fonts.list', [])) as any[];
    const font = list.find((item) => String(item?.name ?? '') === name);
    return { name, fileData: font?.fileData ?? null };
  }
  if (path === 'fonts.getByName') {
    const name = String((input as any)?.name ?? '').trim();
    const list = (await getListCache('fonts.list', [])) as any[];
    return list.find((item) => String(item?.name ?? '') === name) ?? null;
  }
  if (path === 'fonts.create') {
    const payload = (input as any) ?? {};
    const list = (await getListCache('fonts.list', [])) as any[];
    const now = new Date().toISOString();
    const entry = {
      id: Date.now(),
      name: payload.name,
      displayName: payload.displayName,
      url: payload.url ?? null,
      isLocal: Boolean(payload.isLocal ?? false),
      weights: payload.weights ?? [400],
      category: payload.category ?? 'sans-serif',
      isSystem: Boolean(payload.isSystem ?? false),
      sortOrder: Number(payload.sortOrder ?? list.length),
      createdAt: now,
      updatedAt: now,
      fileData: payload.fileData ?? null,
    };
    await setListCache('fonts.list', [entry, ...list]);
    return entry;
  }
  if (path === 'fonts.update') {
    const payload = (input as any) ?? {};
    const list = (await getListCache('fonts.list', [])) as any[];
    const updated = list.map((font) => {
      if (String(font?.id) !== String(payload?.id)) return font;
      return { ...font, ...(payload?.data ?? {}), updatedAt: new Date().toISOString() };
    });
    await setListCache('fonts.list', updated);
    return updated.find((font) => String(font?.id) === String(payload?.id)) ?? null;
  }
  if (path === 'fonts.delete') {
    const payload = (input as any) ?? {};
    const list = (await getListCache('fonts.list', [])) as any[];
    const next = list.filter((font) => String(font?.id) !== String(payload?.id));
    await setListCache('fonts.list', next);
    return { success: true };
  }
  if (path === 'fonts.upload') {
    const payload = (input as any) ?? {};
    const list = (await getListCache('fonts.list', [])) as any[];
    const now = new Date().toISOString();
    const entry = {
      id: Date.now(),
      name: payload.name,
      displayName: payload.displayName,
      url: null,
      isLocal: true,
      weights: payload.weights ?? [100, 200, 300, 400, 500, 600, 700, 800, 900],
      category: payload.category ?? 'sans-serif',
      isSystem: false,
      sortOrder: list.length,
      createdAt: now,
      updatedAt: now,
      fileData: payload.fileData ?? null,
    };
    await setListCache('fonts.list', [entry, ...list]);
    return entry;
  }
  if (path.startsWith('fonts.')) {
    return await getOrInitCached(path, input, null);
  }

  if (path === 'users.detail') {
    const id = Number((input as any)?.id ?? getUserSnapshot()?.user?.id ?? 0);
    if (!id) {
      const fallback = fallbackForPath(path);
      return await getOrInitCached(path, input, fallback);
    }
    const user = await getLocalUserById(id);
    if (!user) {
      const fallback = fallbackForPath(path);
      return await getOrInitCached(path, input, fallback);
    }
    return {
      id: user.id,
      name: user.name,
      nickName: user.nickname,
      token: user.token,
      loginType: 'local',
      isLinked: false,
      image: user.image ?? null,
      role: user.role,
    };
  }
  if (path === 'users.list') {
    const list = await listLocalUsers();
    return list.map((user) => ({
      id: user.id,
      name: user.name,
      nickname: user.nickname,
      role: user.role,
      image: user.image ?? null,
      loginType: 'local',
      password: '',
    }));
  }
  if (path === 'users.canRegister') {
    const count = await countLocalUsers();
    if (count === 0) return true;
    const config = (await getListCache('config.list', {})) as Record<string, any>;
    if (typeof config?.isAllowRegister === 'boolean') return config.isAllowRegister;
    return true;
  }
  if (path === 'users.register') {
    const payload = (input as any) ?? {};
    const name = String(payload.name || '').trim();
    const password = String(payload.password || '');
    if (!name || !password) return true;
    const exists = await getLocalUserAuthRecord(name);
    if (exists) throw new Error('User already exists');
    const count = await countLocalUsers();
    const role = count === 0 ? 'superadmin' : 'user';
    const { hash, salt } = await hashPassword(password);
    const token = generateLocalToken();
    await createLocalUser({
      name,
      passwordHash: hash,
      passwordSalt: salt,
      nickname: name,
      role,
      token,
    });
    return true;
  }
  if (path === 'users.upsertUser') {
    const payload = (input as any) ?? {};
    const id = Number(payload.id ?? getUserSnapshot()?.user?.id ?? 0);
    if (!id) throw new Error('Missing user id');
    if (payload.originalPassword) {
      const auth = await getLocalUserAuthRecordById(id);
      if (!auth) throw new Error('User not found');
      const ok = await verifyPassword(String(payload.originalPassword), String(auth.password_hash), String(auth.password_salt));
      if (!ok) throw new Error('Password is incorrect');
    }
    let passwordHash: string | undefined;
    let passwordSalt: string | undefined;
    if (payload.password) {
      const hashed = await hashPassword(String(payload.password));
      passwordHash = hashed.hash;
      passwordSalt = hashed.salt;
    }
    await updateLocalUser({
      id,
      name: payload.name,
      nickname: payload.nickname,
      image: payload.image,
      passwordHash,
      passwordSalt,
    });
    return true;
  }
  if (path === 'users.upsertUserByAdmin') {
    const payload = (input as any) ?? {};
    if (payload.id) {
      let passwordHash: string | undefined;
      let passwordSalt: string | undefined;
      if (payload.password) {
        const hashed = await hashPassword(String(payload.password));
        passwordHash = hashed.hash;
        passwordSalt = hashed.salt;
      }
      await updateLocalUser({
        id: Number(payload.id),
        name: payload.name,
        nickname: payload.nickname,
        passwordHash,
        passwordSalt,
      });
      return true;
    }
    const name = String(payload.name || '').trim();
    const password = String(payload.password || '');
    if (!name || !password) throw new Error('Missing required parameters');
    const exists = await getLocalUserAuthRecord(name);
    if (exists) throw new Error('User already exists');
    const { hash, salt } = await hashPassword(password);
    const token = generateLocalToken();
    await createLocalUser({
      name,
      passwordHash: hash,
      passwordSalt: salt,
      nickname: payload.nickname ?? name,
      role: 'user',
      token,
    });
    return true;
  }
  if (path === 'users.genLowPermToken') {
    const id = Number(getUserSnapshot()?.user?.id ?? 0);
    const user = id ? await getLocalUserById(id) : null;
    return { token: user?.token ?? '' };
  }
  if (path === 'users.regenToken') {
    const id = Number(getUserSnapshot()?.user?.id ?? 0);
    if (!id) return { token: '' };
    const newToken = generateLocalToken();
    await updateLocalUserToken(id, newToken);
    return { token: newToken };
  }
  if (path === 'users.nativeAccountList' || path === 'users.publicUserList') {
    const list = await listLocalUsers();
    return list.map((user) => ({
      id: user.id,
      name: user.name,
      nickname: user.nickname,
      role: user.role,
      image: user.image ?? null,
      loginType: 'local',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: null,
      linkAccountId: null,
    }));
  }
  if (path === 'users.linkAccount' || path === 'users.unlinkAccount') {
    return true;
  }
  if (path === 'users.deleteUser') {
    const id = Number((input as any)?.id ?? 0);
    if (!id) throw new Error('Missing user id');
    await deleteLocalUser(id);
    return true;
  }
  if (path.startsWith('users.')) {
    return true;
  }

  if (path === 'attachments.list') {
    const payload = (input as any) ?? {};
    const page = Number(payload.page ?? 1);
    const size = Number(payload.size ?? 10);
    const searchText = String(payload.searchText ?? '').toLowerCase();
    const folder = String(payload.folder ?? '');
    let list = (await getListCache(path, [])) as any[];
    if (searchText) {
      list = list.filter((item) => String(item?.name ?? '').toLowerCase().includes(searchText));
    }

    const normalizedFolder = sanitizePath(folder.replace(/\/$/, ''));
    const folderPrefix = normalizedFolder ? `${normalizedFolder}/` : '';
    const folders = new Map<string, any>();
    const files: any[] = [];

    for (const item of list) {
      const rel = getAttachmentRelPath(String(item?.path ?? ''));
      if (!rel) continue;
      if (normalizedFolder) {
        if (!rel.startsWith(folderPrefix)) continue;
        const rest = rel.slice(folderPrefix.length);
        if (!rest) {
          if (item?.isFolder) {
            folders.set(rel, item);
          } else {
            files.push(item);
          }
          continue;
        }
        const nextSeg = rest.split('/')[0];
        if (rest.includes('/')) {
          const childRel = `${normalizedFolder}/${nextSeg}`;
          if (!folders.has(childRel)) {
            folders.set(childRel, buildFolderEntry(childRel));
          }
        } else {
          files.push(item);
        }
      } else {
        const segments = rel.split('/');
        if (segments.length > 1) {
          const childRel = segments[0];
          if (!folders.has(childRel)) {
            folders.set(childRel, buildFolderEntry(childRel));
          }
        } else {
          files.push(item);
        }
      }
    }

    let combined = [...folders.values(), ...files];
    combined = combined.sort((a, b) => {
      const isFolderA = a?.isFolder ? 1 : 0;
      const isFolderB = b?.isFolder ? 1 : 0;
      if (isFolderA !== isFolderB) return isFolderB - isFolderA;
      return Number(b?.updatedAt ?? 0) - Number(a?.updatedAt ?? 0);
    });
    const start = (page - 1) * size;
    return combined.slice(start, start + size);
  }
  if (path === 'attachments.createFolder') {
    const payload = (input as any) ?? {};
    const folderName = String(payload.folderName || '').trim();
    const parentFolder = String(payload.parentFolder || '').trim();
    if (!folderName) return true;
    const folderPath = parentFolder ? `${parentFolder}/${folderName}` : folderName;
    const { BaseDirectory } = await loadFs();
    await ensureDir(`${LOCAL_FILE_ROOT}/${sanitizePath(folderPath)}`, BaseDirectory.AppData);
    const now = new Date().toISOString();
    const entry = {
      id: Date.now(),
      path: buildFileApiPath(folderPath, true),
      name: folderName,
      size: null,
      type: 'folder',
      isShare: false,
      sharePassword: '',
      noteId: null,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      isFolder: true,
      folderName: folderName,
    };
    await addAttachmentCacheEntry(entry);
    return { success: true, folderName, folderPath };
  }
  if (path === 'attachments.rename') {
    const payload = (input as any) ?? {};
    const id = payload.id;
    const newName = String(payload.newName || '').trim();
    if (!newName) throw new Error('Missing new name');
    const list = (await getListCache('attachments.list', [])) as any[];
    const target = list.find((item) => id && String(item?.id) === String(id));
    if (!target) return true;
    const oldPath = String(target?.path ?? '');
    const isFolder = Boolean(target?.isFolder) || oldPath.endsWith('/');
    const oldRel = normalizeFolderRel(oldPath);
    const parent = getParentPath(oldRel);
    const newRel = parent ? `${parent}/${newName}` : newName;

    await moveLocalPath(LOCAL_FILE_ROOT, oldRel, newRel);

    const next = list.map((item) => {
      let nextItem = item;
      const itemPath = String(item?.path ?? '');
      if (isFolder && (itemPath.startsWith(`/api/file/${encodePathSegments(oldRel)}/`) || itemPath.startsWith(`/api/file/${oldRel}/`))) {
        nextItem = { ...nextItem, path: replacePathPrefix(itemPath, oldRel, newRel), updatedAt: new Date().toISOString() };
      }
      if (id && String(item?.id) === String(id)) {
        const newPath = isFolder ? buildFileApiPath(newRel, true) : buildFileApiPath(newRel, false);
        nextItem = { ...nextItem, name: newName, path: newPath, updatedAt: new Date().toISOString() };
      }
      return nextItem;
    });
    await setListCache('attachments.list', next);
    return true;
  }
  if (path === 'attachments.move') {
    const payload = (input as any) ?? {};
    const sourceIds: number[] = payload.sourceIds ?? [];
    const targetFolder = String(payload.targetFolder ?? '').trim();
    const targetRel = sanitizePath(targetFolder);
    const list = (await getListCache('attachments.list', [])) as any[];
    const mappings = sourceIds.map((id) => {
      const entry = list.find((item) => String(item?.id) === String(id));
      if (!entry) return null;
      const entryPath = String(entry?.path ?? '');
      const isFolder = Boolean(entry?.isFolder) || entryPath.endsWith('/');
      const oldRel = normalizeFolderRel(entryPath);
      const baseName = oldRel.split('/').filter(Boolean).pop() || oldRel;
      const newRel = targetRel ? `${targetRel}/${baseName}` : baseName;
      return { id, oldRel, newRel, isFolder };
    }).filter(Boolean) as Array<{ id: number; oldRel: string; newRel: string; isFolder: boolean }>;

    for (const mapping of mappings) {
      await moveLocalPath(LOCAL_FILE_ROOT, mapping.oldRel, mapping.newRel);
    }

    const next = list.map((item) => {
      let nextItem = item;
      const itemPath = String(item?.path ?? '');
      for (const mapping of mappings) {
        if (mapping.isFolder) {
          if (itemPath.startsWith(`/api/file/${encodePathSegments(mapping.oldRel)}/`) || itemPath.startsWith(`/api/file/${mapping.oldRel}/`)) {
            nextItem = { ...nextItem, path: replacePathPrefix(itemPath, mapping.oldRel, mapping.newRel), updatedAt: new Date().toISOString() };
          }
        } else if (String(item?.id) === String(mapping.id)) {
          nextItem = { ...nextItem, path: buildFileApiPath(mapping.newRel, false), updatedAt: new Date().toISOString() };
        }
      }
      return nextItem;
    });

    await setListCache('attachments.list', next);
    return { message: 'Files moved successfully' };
  }
  if (path === 'attachments.delete') {
    const payload = (input as any) ?? {};
    const id = payload.id;
    const list = (await getListCache('attachments.list', [])) as any[];
    const target = list.find((item) => String(item?.id) === String(id));
    if (target) {
      const rel = stripFileApiPrefix(String(target?.path ?? ''));
      const isFolder = Boolean(target?.isFolder) || String(target?.path ?? '').endsWith('/');
      await removeLocalFile(LOCAL_FILE_ROOT, rel, isFolder);
    }
    const targetPath = String(target?.path ?? '');
    const prefixEncoded = targetPath.endsWith('/') ? targetPath : `${targetPath}/`;
    const next = list.filter((item) => {
      if (String(item?.id) === String(id)) return false;
      if (!target?.isFolder && !targetPath.endsWith('/')) return true;
      const itemPath = String(item?.path ?? '');
      return !itemPath.startsWith(prefixEncoded);
    });
    await setListCache('attachments.list', next);
    return true;
  }
  if (path === 'attachments.deleteMany') {
    const payload = (input as any) ?? {};
    const ids: number[] = payload.ids ?? [];
    const list = (await getListCache('attachments.list', [])) as any[];
    const idSet = new Set(ids.map((id) => String(id)));
    for (const entry of list) {
      if (!idSet.has(String(entry?.id))) continue;
      const rel = stripFileApiPrefix(String(entry?.path ?? ''));
      const isFolder = Boolean(entry?.isFolder) || String(entry?.path ?? '').endsWith('/');
      await removeLocalFile(LOCAL_FILE_ROOT, rel, isFolder);
    }
    const next = list.filter((item) => {
      if (idSet.has(String(item?.id))) return false;
      const itemPath = String(item?.path ?? '');
      for (const entry of list) {
        if (!idSet.has(String(entry?.id))) continue;
        const entryPath = String(entry?.path ?? '');
        const isFolder = Boolean(entry?.isFolder) || entryPath.endsWith('/');
        if (!isFolder) continue;
        const prefix = entryPath.endsWith('/') ? entryPath : `${entryPath}/`;
        if (itemPath.startsWith(prefix)) return false;
      }
      return true;
    });
    await setListCache('attachments.list', next);
    return true;
  }
  if (path.startsWith('attachments.')) {
    return true;
  }

  if (path.startsWith('analytics.')) {
    return await getOrInitCached(path, input, {});
  }
  if (path.startsWith('ai.') || path.startsWith('aiTask.')) {
    return await getOrInitCached(path, input, guessFallback(path));
  }
  if (path.startsWith('comments.')) {
    return await getOrInitCached(path, input, []);
  }
  if (path.startsWith('conversation.') || path.startsWith('message.') || path.startsWith('follows.') || path.startsWith('mcpServers.')) {
    return await getOrInitCached(path, input, guessFallback(path));
  }
  if (path.startsWith('public.')) {
    return await getOrInitCached(path, input, {});
  }

  const fallback = fallbackForPath(path);
  return await getOrInitCached(path, input, fallback);
};

const handleLocalApi = async (request: Request) => {
  const url = safeNewUrl(request.url, window.location.origin, 'handleLocalApi');
  const tokenData: any = getUserSnapshot();
  const token = tokenData?.token;

  if (url.pathname === '/api/auth/login') {
    try {
      await initLocalDb();
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        });
      }
      const payload = await request.json();
      const username = String(payload?.username || '').trim();
      const password = String(payload?.password || '');
      if (!username || !password) {
        return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const record = await getLocalUserAuthRecord(username);
      if (!record) {
        return new Response(JSON.stringify({ error: 'Authentication failed' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      const ok = await verifyPassword(password, String(record.password_hash), String(record.password_salt));
      if (!ok) {
        return new Response(JSON.stringify({ error: 'Authentication failed' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      const newToken = generateLocalToken();
      await updateLocalUserToken(Number(record.id), newToken);
      return new Response(JSON.stringify({
        user: {
          id: Number(record.id),
          name: String(record.name),
          role: String(record.role ?? 'user'),
          nickname: String(record.nickname ?? record.name),
          image: record.image ?? null,
        },
        token: newToken,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Login error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  if (url.pathname.startsWith('/api/file/upload-by-url')) {
    try {
      const payload = await request.json();
      const targetUrl = payload?.url;
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'No URL provided' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const remote = await fetch(targetUrl);
      if (!remote.ok) {
        return new Response(JSON.stringify({ error: 'Failed to fetch file from URL' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const buffer = new Uint8Array(await remote.arrayBuffer());
      const urlPath = safeNewUrl(targetUrl, window.location.origin, 'uploadByUrl').pathname;
      const originalName = urlPath.split('/').pop() || `file-${Date.now()}`;
      await writeLocalFile(LOCAL_FILE_ROOT, originalName, buffer);
      await addAttachmentCacheEntry({
        id: Date.now(),
        path: buildFileApiPath(originalName, false),
        name: originalName,
        size: String(buffer.length),
        type: remote.headers.get('content-type') || '',
        isShare: false,
        sharePassword: '',
        noteId: null,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isFolder: false,
        folderName: null,
      });
      return new Response(JSON.stringify({
        Message: 'Success',
        status: 200,
        filePath: buildFileApiPath(originalName, false),
        fileName: originalName,
        originalURL: targetUrl,
        type: remote.headers.get('content-type') || '',
        size: buffer.length,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to upload file from URL' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  if (url.pathname.startsWith('/api/file/upload')) {
    try {
      const formData = await request.formData();
      const fileEntries = Array.from(formData.values()).filter((entry) => entry instanceof File) as File[];
      const file = fileEntries[0];
      if (!file) {
        return new Response(JSON.stringify({ error: 'No files received.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      const safeName = file.name?.replace(/\s+/g, '_') || `file-${Date.now()}`;
      await writeLocalFile(LOCAL_FILE_ROOT, safeName, buffer);
      await addAttachmentCacheEntry({
        id: Date.now(),
        path: buildFileApiPath(safeName, false),
        name: safeName,
        size: String(file.size || buffer.length),
        type: file.type || '',
        isShare: false,
        sharePassword: '',
        noteId: null,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isFolder: false,
        folderName: null,
      });
      return new Response(JSON.stringify({
        Message: 'Success',
        status: 200,
        filePath: buildFileApiPath(safeName, false),
        fileName: safeName,
        type: file.type || '',
        size: file.size || buffer.length,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Upload failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  if (url.pathname.startsWith('/api/file/delete')) {
    try {
      const payload = await request.json();
      const attachmentPath = payload?.attachment_path as string | undefined;
      if (!attachmentPath) {
        return new Response(JSON.stringify({ error: 'Missing attachment_path parameter' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const rel = stripFileApiPrefix(attachmentPath);
      const isFolder = attachmentPath.endsWith('/');
      await removeLocalFile(LOCAL_FILE_ROOT, rel, isFolder);
      const list = (await getListCache('attachments.list', [])) as any[];
      const next = list.filter((item) => String(item?.path ?? '') !== attachmentPath);
      await setListCache('attachments.list', next);
      return new Response(JSON.stringify({ Message: 'Success', status: 200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Delete failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  if (url.pathname.startsWith('/api/file/')) {
    const rel = stripFileApiPrefix(url.pathname);
    const cached = await readLocalFile(LOCAL_FILE_ROOT, rel);
    if (cached) {
      const contentType = guessContentType(rel);
      return new Response(cached.data, { status: 200, headers: { 'content-type': contentType } });
    }
    return await fetchAndCacheFile(request, LOCAL_FILE_ROOT, rel);
  }

  if (url.pathname.startsWith('/api/s3file/')) {
    const rel = sanitizePath(url.pathname.replace('/api/s3file/', ''));
    const cached = await readLocalFile(LOCAL_S3_ROOT, rel);
    if (cached) {
      const contentType = guessContentType(rel);
      return new Response(cached.data, { status: 200, headers: { 'content-type': contentType } });
    }
    return await fetchAndCacheFile(request, LOCAL_S3_ROOT, rel);
  }

  if (url.pathname.startsWith('/api/plugins/')) {
    const rel = sanitizePath(url.pathname.replace('/api/plugins/', ''));
    const cached = await readLocalFile(LOCAL_PLUGIN_ROOT, rel);
    if (cached) {
      const contentType = guessContentType(rel);
      return new Response(cached.data, { status: 200, headers: { 'content-type': contentType } });
    }
    return await fetchAndCacheFile(request, LOCAL_PLUGIN_ROOT, rel);
  }

  if (url.pathname === '/api/auth/profile') {
    if (!token || !tokenData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(tokenData), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.pathname === '/api/auth/logout') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.pathname.startsWith('/api/auth/')) {
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.pathname.startsWith('/api/v1/')) {
    const trpcPath = mapV1ToTrpc(url.pathname);
    if (trpcPath) {
      const payload = request.method === 'GET' ? queryParamsToObject(url) : await readJsonBody(request);
      const data = await handleLocalTrpc(trpcPath, payload);
      return new Response(JSON.stringify(data ?? {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const fallback = guessFallback(url.pathname);
    return new Response(JSON.stringify(fallback ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return null;
};

const createProxyFetch = (realFetch: typeof fetch) => {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const request = input instanceof Request
        ? input
        : new Request(
            safeResolveUrl(typeof input === 'string' ? input : input?.toString?.(), window.location.origin),
            init,
          );
      const url = safeNewUrl(request.url, window.location.origin, 'proxyFetch');
      const base = RootStore.Get(BaseStore);

      if (url.pathname.startsWith('/api/trpc/')) {
        const path = url.pathname.replace('/api/trpc/', '');
        try {
          const inputData = await decodeInput(request);
          const data = await handleLocalTrpc(path, inputData);
          base.setOnlineStatusFromSuccess();
          return buildTrpcResponse(data);
        } catch (error) {
          return buildTrpcError(String((error as any)?.message ?? error));
        }
      }

      if (url.pathname.startsWith('/api/')) {
        const localResponse = await handleLocalApi(request);
        if (localResponse) return localResponse;
        return new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }

      const isRemote = isRemoteRequest(url);
      if (isRemote) {
        return new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }

      return realFetch(request);
    } catch (error) {
      return Promise.reject(error);
    }
  };
};

export const installLocalProxy = () => {
  if (!isInTauri()) return;
  if (installed) return;
  installed = true;

  const realFetch = globalThis.fetch.bind(globalThis);
  (globalThis as any).__BLINKO_RAW_FETCH = realFetch;
  globalThis.fetch = createProxyFetch(realFetch);

  axios.defaults.adapter = createAxiosFetchAdapter() as any;
  void ensureLocalAuth();
};

export const __offlineTest = {
  handleLocalTrpc,
  handleLocalApi,
};

const createAxiosFetchAdapter = () => {
  return async (config: any) => {
    const url = safeResolveUrl(config.url, config.baseURL);
    const method = (config.method || 'get').toUpperCase();
    const headers = config.headers || {};
    const body = method === 'GET' || method === 'HEAD' ? undefined : config.data;

    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: config.signal,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let data: any;
    const responseType = config.responseType || 'json';
    if (responseType === 'arraybuffer') {
      data = await response.arrayBuffer();
    } else if (responseType === 'blob') {
      data = await response.blob();
    } else if (responseType === 'text') {
      data = await response.text();
    } else if (responseType === 'json') {
      const text = await response.text();
      data = text ? JSON.parse(text) : null;
    } else {
      data = await response.text();
    }

    return {
      data,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      config,
      request: null,
    };
  };
};
