#!/usr/bin/env bun
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd());

const makeLocalStorage = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
};

const makeElement = () => ({
  style: {},
  data: '',
  firstChild: { data: '' },
  classList: { add: () => {}, remove: () => {}, contains: () => false },
  setAttribute: () => {},
  appendChild: () => {},
  removeChild: () => {},
  remove: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createTextNode: () => ({}),
});

const setupGlobals = () => {
  const localStorage = makeLocalStorage();
  const head = makeElement();
  const body = makeElement();

  globalThis.window = {
    location: { origin: 'http://localhost', pathname: '/', search: '' },
    localStorage,
    navigator: { onLine: false, userAgent: 'offline-test' },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  if (!globalThis.window.HTMLElement) {
    class StubHTMLElement {}
    (StubHTMLElement.prototype).focus = () => {};
    globalThis.window.HTMLElement = StubHTMLElement;
  }
  if (!globalThis.HTMLElement) {
    globalThis.HTMLElement = globalThis.window.HTMLElement;
  }

  globalThis.document = {
    documentElement: { classList: { contains: () => false }, style: {} },
    head,
    body,
    cookie: '',
    createElement: () => makeElement(),
    createTextNode: () => ({}),
    getElementsByTagName: (name) => (name === 'head' ? [head] : name === 'body' ? [body] : []),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false, userAgent: 'offline-test' },
      configurable: true,
    });
  } catch {
    globalThis.navigator = { onLine: false, userAgent: 'offline-test' };
  }

  // seed local token for offline profile
  window.localStorage.setItem(
    'blinkoToken',
    JSON.stringify({
      token: 'offline-token',
      user: { id: '1', name: 'offline', nickname: 'offline', role: 'user', image: '' },
    }),
  );
};

const parseAppRouter = () => {
  const appRouterPath = path.join(repoRoot, 'server/routerTrpc/_app.ts');
  const text = fs.readFileSync(appRouterPath, 'utf-8');
  const importMap = new Map();
  const importRegex = /import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+'\.\/([^']+)'/g;
  let match;
  while ((match = importRegex.exec(text))) {
    importMap.set(match[1], match[2]);
  }

  const routerKeyMap = new Map();
  const appRouterBlock = text.split('appRouter = router({')[1] || '';
  const routerEntries = appRouterBlock.split('});')[0] || '';
  const entryRegex = /\n\s*([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)/g;
  while ((match = entryRegex.exec(routerEntries))) {
    const key = match[1];
    const varName = match[2];
    const file = importMap.get(varName);
    if (file) routerKeyMap.set(key, file);
  }
  return routerKeyMap;
};

const parseProcedures = (fileBase) => {
  const filePath = path.join(repoRoot, 'server/routerTrpc', `${fileBase}.ts`);
  if (!fs.existsSync(filePath)) return [];
  let text = fs.readFileSync(filePath, 'utf-8');
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  text = text.replace(/\/\/.*$/gm, '');
  const regex = /\n\s*([A-Za-z0-9_]+)\s*:\s*(authProcedure|publicProcedure|t\.procedure|router)/g;
  const names = new Set();
  let match;
  while ((match = regex.exec(text))) {
    names.add(match[1]);
  }
  return [...names];
};

const buildInput = () => ({
  id: 1,
  ids: [1],
  page: 1,
  size: 1,
  searchText: '',
  content: 'offline-test',
  tag: 'tag',
  oldName: 'old',
  newName: 'new',
  sortOrder: 0,
  icon: 'icon',
  title: 'title',
  metadata: {},
  type: 0,
});

const run = async () => {
  setupGlobals();

  const { __offlineTest } = await import(path.join(repoRoot, 'app/src/lib/localProxy.ts'));

  const routerKeyMap = parseAppRouter();
  const endpoints = [];
  for (const [routerKey, fileBase] of routerKeyMap.entries()) {
    const procedures = parseProcedures(fileBase);
    for (const proc of procedures) {
      endpoints.push(`${routerKey}.${proc}`);
    }
  }

  const results = [];
  for (const endpoint of endpoints.sort()) {
    try {
      const value = await __offlineTest.handleLocalTrpc(endpoint, buildInput());
      results.push({ endpoint, ok: true, type: typeof value });
    } catch (error) {
      results.push({ endpoint, ok: false, error: String(error?.message || error) });
    }
  }

  const apiChecks = [];
  const apiPaths = [
    '/api/auth/profile',
    '/api/auth/logout',
    '/api/auth/login',
    '/api/v1/comment/list',
    '/api/v1/note/public-list',
  ];
  for (const apiPath of apiPaths) {
    try {
      const req = new Request(`http://localhost${apiPath}`, { method: 'GET' });
      const res = await __offlineTest.handleLocalApi(req);
      apiChecks.push({ endpoint: apiPath, ok: Boolean(res), status: res?.status ?? 'none' });
    } catch (error) {
      apiChecks.push({ endpoint: apiPath, ok: false, error: String(error?.message || error) });
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('Offline endpoint check (tRPC):');
  console.log(`Total: ${results.length}, OK: ${results.length - failed.length}, Fail: ${failed.length}`);
  if (failed.length) {
    console.log('Failures:');
    for (const item of failed) {
      console.log(`- ${item.endpoint}: ${item.error}`);
    }
  }

  console.log('\nOffline endpoint check (REST):');
  for (const item of apiChecks) {
    console.log(`- ${item.endpoint}: ${item.ok ? 'OK' : 'FAIL'} (${item.status ?? 'n/a'})`);
  }
};

run().catch((error) => {
  console.error('offline_endpoint_check failed:', error);
  process.exit(1);
});
