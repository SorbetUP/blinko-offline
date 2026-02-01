#!/usr/bin/env bun
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import superjson from 'superjson';
import { Database } from 'bun:sqlite';
import { createLocalNotesService } from '../../../shared/local-backend/localNotesService.ts';
import { createCliDbAdapter } from './localDbAdapter.mjs';

const CONFIG_PATH = path.join(os.homedir(), '.blinko-cli.json');
const DEFAULT_BASE_URL = 'http://127.0.0.1:1111';
const DEFAULT_DB = path.join(os.homedir(), 'Library/Application Support/com.blinko.app/blinko_local.db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
};

const saveConfig = (config) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch {
    // ignore
  }
};

const trpcCall = async ({ baseUrl, token, path, input }) => {
  const url = `${baseUrl.replace(/\/$/, '')}/api/trpc/${path}`;
  const payload = superjson.serialize(input ?? {});
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json?.error) {
    const message = json?.error?.message || res.statusText || 'TRPC error';
    throw new Error(message);
  }
  return superjson.deserialize(json.result.data);
};

const login = async ({ baseUrl, username, password }) => {
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || res.statusText || 'Login failed');
  if (json?.requiresTwoFactor) {
    return { requiresTwoFactor: true, userId: json.userId };
  }
  return { token: json.token, user: json.user };
};

const verify2fa = async ({ baseUrl, userId, code }) => {
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/verify-2fa`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, code }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || res.statusText || '2FA failed');
  return { token: json.token, user: json.user };
};

const print = (value) => {
  process.stdout.write(`${value}\n`);
};

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
};

const requireConfig = (config) => {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const token = config.token || '';
  return { baseUrl, token };
};

const loadDbCounts = (dbPath) => {
  if (!fs.existsSync(dbPath)) return { cached: 0, pending: 0 };
  const db = new Database(dbPath);
  const cached = db.query('SELECT COUNT(*) as count FROM cached_notes').get()?.count ?? 0;
  const pending = db.query('SELECT COUNT(*) as count FROM pending_ops').get()?.count ?? 0;
  return { cached, pending };
};

const resolveUserId = (config) => {
  return config?.user?.id || config?.user?.userId || '';
};

const getLocalBackend = (config, dbOverride) => {
  const dbPath = dbOverride || config.dbPath || DEFAULT_DB;
  const userId = resolveUserId(config);
  const db = createCliDbAdapter(dbPath);
  const service = createLocalNotesService({
    getUserId: () => userId,
    db,
  });
  return { dbPath, userId, db, service };
};

const showHelp = () => {
  print('Blinko CLI (backend local-first, identique a la GUI pour les notes)');
  print('Commands:');
  print('  login --base <url> --username <user> --password <pass>');
  print('  status');
  print('  set-base --base <url>');
  print('  logout');
  print('  notes:list [--search <text>] [--page <n>] [--size <n>]');
  print('  notes:detail <id>');
  print('  notes:create --content <text>');
  print('  notes:update <id> --content <text>');
  print('  notes:trash <id>');
  print('  local:notes:list [--db <path>]');
  print('  local:notes:detail <id> [--db <path>]');
  print('  local:notes:create --content <text> [--db <path>]');
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  const config = loadConfig();
  const { baseUrl, token } = requireConfig(config);

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp();
    process.exit(0);
  }

  if (cmd === 'login') {
    const base = args.base || baseUrl;
    const username = args.username || await rl.question('Username: ');
    const password = args.password || await rl.question('Password: ');
    const res = await login({ baseUrl: base, username, password });
    let tokenValue = res.token;
    let user = res.user || { nickname: username };
    if (res.requiresTwoFactor) {
      const code = await rl.question('2FA Code: ');
      const verified = await verify2fa({ baseUrl: base, userId: res.userId, code });
      tokenValue = verified.token;
      user = verified.user || user;
    }
    saveConfig({ baseUrl: base, token: tokenValue, user, username });
    print('Login OK');
    process.exit(0);
  }

  if (cmd === 'logout') {
    saveConfig({ baseUrl, token: '', user: null, username: null });
    print('Logged out');
    process.exit(0);
  }

  if (cmd === 'set-base') {
    const base = args.base || baseUrl;
    saveConfig({ ...config, baseUrl: base });
    print(`Base URL set to ${base}`);
    process.exit(0);
  }

  if (cmd === 'status') {
    const dbPath = config.dbPath || DEFAULT_DB;
    const counts = loadDbCounts(dbPath);
    print(`Base URL: ${baseUrl}`);
    print(`Token: ${token ? 'present' : 'missing'}`);
    print(`DB: ${dbPath} | cached_notes=${counts.cached} pending_ops=${counts.pending}`);
    print('Notes backend: local-first (meme logique que GUI)');
    process.exit(0);
  }

  if (cmd === 'notes:list') {
    const { service } = getLocalBackend(config);
    const page = Number(args.page ?? 1);
    const size = Number(args.size ?? 30);
    const searchText = args.search || '';
    const notes = await service.list({ page, size, searchText });
    for (const note of notes) {
      print(`${note.id}  ${String(note.content ?? '').slice(0, 120)}`);
    }
    process.exit(0);
  }

  if (cmd === 'notes:detail') {
    const id = Number(args._[1]);
    if (!id) throw new Error('Missing note id');
    const { service } = getLocalBackend(config);
    const note = await service.detail({ id });
    print(JSON.stringify(note, null, 2));
    process.exit(0);
  }

  if (cmd === 'notes:create') {
    const content = args.content || '';
    if (!content) throw new Error('Missing --content');
    const { service } = getLocalBackend(config);
    const note = await service.upsert({ content });
    print(`Created ${note.id}`);
    process.exit(0);
  }

  if (cmd === 'notes:update') {
    const id = Number(args._[1]);
    const content = args.content || '';
    if (!id) throw new Error('Missing note id');
    if (!content) throw new Error('Missing --content');
    const { service } = getLocalBackend(config);
    const note = await service.upsert({ id, content });
    print(`Updated ${note.id}`);
    process.exit(0);
  }

  if (cmd === 'notes:trash') {
    const id = Number(args._[1]);
    if (!id) throw new Error('Missing note id');
    const { service } = getLocalBackend(config);
    const note = await service.upsert({ id, isRecycle: true });
    print(`Trashed ${note.id}`);
    process.exit(0);
  }

  if (cmd === 'local:notes:list') {
    const { service } = getLocalBackend(config, args.db);
    const notes = await service.list({ page: 1, size: 30, searchText: '' });
    for (const note of notes) {
      print(`${note.id}  ${String(note.content ?? '').slice(0, 120)}`);
    }
    process.exit(0);
  }

  if (cmd === 'local:notes:detail') {
    const id = Number(args._[1]);
    if (!id) throw new Error('Missing note id');
    const { service } = getLocalBackend(config, args.db);
    const note = await service.detail({ id });
    print(JSON.stringify(note, null, 2));
    process.exit(0);
  }

  if (cmd === 'local:notes:create') {
    const content = args.content || '';
    if (!content) throw new Error('Missing --content');
    const { service } = getLocalBackend(config, args.db);
    const note = await service.upsert({ content });
    print(`Created ${note.id}`);
    process.exit(0);
  }

  if (cmd === 'remote:notes:list') {
    const notes = await trpcCall({ baseUrl, token, path: 'notes.list', input: { page: 1, size: 30 } });
    for (const note of notes) {
      print(`${note.id}  ${String(note.content ?? '').slice(0, 120)}`);
    }
    process.exit(0);
  }

  showHelp();
  process.exit(1);
};

main().catch((err) => {
  print(`error: ${err?.message || err}`);
  process.exit(1);
});
