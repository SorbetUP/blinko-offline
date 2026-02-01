# Repository Guidelines

## Project Structure & Module Organization
This is a Bun/Turbo monorepo. The main packages are `app/` (React + Vite + Tauri UI), `server/` (Express + tRPC API), and `shared/` (shared utilities/types). Database schema and migrations live in `prisma/`. Type definitions are in `blinko-types/`. Static assets and locale files are in `app/public/`, and desktop/mobile scaffolding is in `app/src-tauri/`. Docker and deployment assets are in `docker-compose*.yml`, `dockerfile`, and `helm/`. Use the existing folder patterns (for example `server/routerExpress/` vs `server/routerTrpc/`) when adding new modules.

## Build, Test, and Development Commands
- `bun install`: install workspace dependencies (Bun is the package manager).
- `bun run dev`: run the full app via Tauri in dev.
- `bun run dev:backend`: start the backend only (uses `.env`).
- `bun run dev:frontend`: start the frontend only.
- `bun run build:web`: build the web app (Turbo).
- `bun run prisma:generate` / `bun run prisma:migrate:dev`: generate Prisma client and apply dev migrations.
- `docker-compose -f docker-compose.prod.yml up -d`: start the production stack via Docker.

## Desktop Builds (macOS ARM)
- Deja configure: `.github/workflows/app-release.yml` utilise `macos-latest` avec `--target aarch64-apple-darwin`.
- Rust toolchain installe aussi `x86_64-apple-darwin` pour un build universal si besoin (ajouter l'arg cible cote workflow).

## Coding Style & Naming Conventions
Code is TypeScript-first and uses ESM imports. Follow the existing 2-space indentation and semicolon usage visible in `server/*.ts`. Keep React components in `app/src/` as `PascalCase` exports with `index.tsx` entry points when the folder already follows that pattern. Prefer `camelCase` for functions/variables, and match the existing folder naming conventions inside each package rather than introducing new ones.

## Testing Guidelines
Automated tests are wired through `bun run test` (Turbo), but the repo currently has minimal test coverage. There is a Docker smoke setup in `test-docker/`. If you add tests, prefer colocated `*.test.ts` or `*.spec.ts` files and ensure the package’s `test` script runs them via Turbo.

## Commit & Pull Request Guidelines
Recent commits use Conventional Commit prefixes like `feat:`, `fix:`, and `chore:` with occasional emoji prefixes and `[ci skip]` for version bumps. Keep subjects short and imperative. PRs should include a clear summary, testing notes (commands + results), and screenshots or recordings for UI changes. Link related issues when applicable.

## Security & Configuration Tips
Copy `.env.tmpl` to `.env` and set at least `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`. Keep secrets out of git. Optional S3 and AI provider keys are supported and should be set per environment.

## Mode Offline (notes) - details d'implementation
Objectif: fournir une experience offline robuste (liste/detail + edition basique) avec stockage local "dur" sur desktop/mobile, tout en gardant un fallback web.

### Architecture generale
- Tauri (desktop + Android): stockage local SQLite via `@tauri-apps/plugin-sql` pour le cache et la queue de sync (pas de localStorage pour les notes).
- Web: cache IndexedDB + queue offline en localStorage (legacy, limite par le navigateur).
- Merge local: en offline, les notes de la queue et du cache sont fusionnees et filtrees localement.

### Fichiers et points d'entree
- Cache multi-backend: `app/src/lib/offlineCache.ts`
  - Tauri: delegue a SQLite (`offlineSqlStore`).
  - Web: IndexedDB `blinko-offline-<userId>` / table `notes`.
  - Fonctions publiques: `saveCachedNote`, `saveCachedNotes`, `getCachedNote`, `listCachedNotes`, `deleteCachedNote`, `clearCachedNotes`.
- SQLite helper: `app/src/lib/offlineSqlStore.ts`
  - DB: `sqlite:blinko_offline.db` (app data dir).
  - Tables: `meta`, `cached_notes`, `pending_notes`.
  - Fonctions: `saveCachedNoteSql`, `listCachedNotesSql`, `getCachedNoteSql`, `savePendingNoteSql`, `listPendingNotesSql`, `clearPendingNotesSql`, etc.
- Store principal: `app/src/store/blinkoStore.tsx`
  - Lecture offline/online dans `getFilteredNotes`.
  - Ecriture offline dans `upsertNote`.
  - Queue offline en SQLite pour Tauri (`offlineNotesData`) ou localStorage web.
  - Sync queue dans `syncOfflineNotes`.
  - Detail offline dans `noteDetail`.
  - Nettoyage au signout via `clear()`.
- Helper sync: `app/src/lib/offlineSync.ts`
  - Normalise les notes offline et construit le payload de sync.
  - Fournit `syncOfflineNotesQueue` pour tester la logique sans UI/DOM.
- Helper filtres/tri offline: `app/src/lib/offlineNoteUtils.ts`
  - `matchesOfflineFilters`, `sortNotes`, `mergeNotes` utilises par `BlinkoStore`.

### Permissions Tauri (obligatoire)
- Ajouter `sql:default` et `sql:allow-execute` dans:
  - `app/src-tauri/capabilities/default.json`
  - `app/src-tauri/capabilities/desktop.json`
  - `app/src-tauri/capabilities/mobile.json`
- Sans `allow-execute`, les CREATE/INSERT/UPDATE SQLite echouent et l'offline devient inutilisable.

### Diagrammes (ASCII)
Flux lecture (online/offline):
```
UI -> BlinkoStore.getFilteredNotes
  | online -> API notes.list -> cache (SQLite/IndexedDB) -> merge offlineNotes -> UI
  | offline -> cache (SQLite/IndexedDB) -> merge offlineNotes -> filter/sort local -> UI
```

Flux ecriture offline (Tauri):
```
Editor -> upsertNote (offline)
  -> pending_notes (SQLite) + cached_notes (SQLite)
  -> updateTicker (refresh UI)
```

Flux ecriture offline (web):
```
Editor -> upsertNote (offline)
  -> offlineNotes (localStorage) + cache IndexedDB
  -> updateTicker (refresh UI)
```

Flux sync:
```
online event -> syncOfflineNotes
  -> upsertNote (server) -> remove offline queue entry
  -> deleteCachedNote (si creation offline) -> refresh UI
```

### Schema SQLite (Tauri)
- `meta`: `key` (TEXT PRIMARY KEY), `value` (TEXT).
  - stocke `last_user_id` pour reutiliser l'utilisateur si besoin.
- `cached_notes`: `user_id`, `note_id`, `note_json`, `cached_at`.
  - `note_json` contient la note complete (JSON) pour limiter les migrations.
- `pending_notes`: `user_id`, `note_id`, `note_json`, `pending_action`, `updated_at`.
  - `pending_action`: `create` ou `update`.

### Cache IndexedDB (web uniquement)
- Bibliotheque: `idb` (dependance `app/package.json`).
- Schema minimal: table `notes` -> `CachedNote`.
- Chaque note est stockee avec `cachedAt` pour eventuelles strategies d'eviction futures.
- Garde-fou: si une note en cache est `pendingSync`, elle n'est pas ecrasee par une version online standard (sauf `force: true`).

### Queue offline (Tauri vs web)
- Tauri: table `pending_notes` (SQLite).
- Web: `offlineNotes` en localStorage (legacy).
- Flags: `pendingSync: true`, `pendingAction: 'create' | 'update'`, `isOffline: true`.

### Lecture offline (listes + detail)
- `getFilteredNotes`:
  - Online: appelle l'API + enregistre les notes en cache (`saveCachedNotes`).
  - Offline: charge cache local (`listCachedNotes`) + merge avec `offlineNotes`.
  - Filtrage local dans `matchesOfflineFilters`.
  - Tri local via `sortNotes`.
- `noteDetail`:
  - Offline: `getCachedNote(id)`.
  - Online: `api.notes.detail` + `saveCachedNote` en cache.

### Synchronisation
- Trigger principal: `use()` dans `BlinkoStore` surveille `isOnline` + `offlineNotes.length` et appelle `syncOfflineNotes`.
- `syncOfflineNotes`:
  - Pour chaque note `pendingSync`, construit un `UpsertNoteParams` (et force `skipEditorClear`).
  - Si `pendingAction` est `create`, envoie sans `id` (nouvelle note serveur).
  - Si `update`, envoie avec `id` (mise a jour serveur).
  - Apres success, supprime la note de la queue offline et, pour les creations offline, supprime l'entree cache locale par `id`.

### Nettoyage et separation par utilisateur
- `clear()` dans `BlinkoStore`:
  - Tauri: efface `pending_notes` + `cached_notes` pour le user actif.
  - Web: efface `offlineNotes` + IndexedDB du user actif.
- `setActiveUserId(userId)` ecrit `last_user_id` en SQLite pour eviter les fuites de notes entre comptes.

### Limites actuelles
- Pas de delta-sync cote serveur: l'offline se base sur les caches locaux et les refresh de liste/detail online.
- Attachments offline non geres: on garde les metadonnees, mais pas de copie locale systematique.
- Conflits: pas de resolution interactive (last-write-wins implicite).
- References: conservees en offline (mapping `references`), mais pas de reconciliation complexe.

### Extensions conseillees
- Attachments offline:
  - Copier les fichiers dans `appDataDir` via `@tauri-apps/plugin-fs`.
  - Ajouter un statut `pendingUpload` par attachment + une table locale `local_files`.
  - Uploader au retour online, remplacer les paths locaux par URLs serveur.
- Delta-sync serveur:
  - Ajouter endpoints `notes.syncChanges`, `tags.syncChanges`, `attachments.syncChanges` (param `since` + `deletedIds`).
  - Permettre un refresh du cache local par timestamp, au lieu de recharger toutes les listes.
- Conflits:
  - Stocker `updatedAt` local + remote; presenter un ecran de resolution si divergences.
- Purge cache:
  - Strategie LRU basee sur `cachedAt` + taille maximale.

### Points d'attention pour les prochains devs
- Ne pas ecraser une note `pendingSync` par une reponse online par defaut (utiliser `force: true` uniquement si necessaire).
- Les notes offline ont des IDs temporaires; eviter de les utiliser comme references serveur tant qu'elles ne sont pas synchronisees.
- `offlineNotes` reste la source de verite pour la queue de sync; le cache sert a la lecture.
- Si vous ajoutez des champs a `Note`, assurez-vous qu'ils soient bien preserves lors des merges offline/online.

### Tests offline
- Tests unitaires pour filtres/tri offline: `app/src/lib/offlineNoteUtils.test.ts`.
- Test d'integration sync offline (queue): `app/src/lib/offlineSync.test.ts`.
- Execution locale:
  - `cd app && bun test src/lib/offlineNoteUtils.test.ts`
  - `cd app && bun test src/lib/offlineSync.test.ts`
- Tests manuels Tauri:
  - Lancer l'app en offline, creer une note, fermer/reouvrir: la note est toujours la.
  - Repasser online: la note est sync et disparait de la queue locale.
