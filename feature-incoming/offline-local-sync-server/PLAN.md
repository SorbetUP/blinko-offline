# Plan: mode offline durable + serveur local allege (unique voie)

## Objectif
- Stabiliser un mode offline **persistant** (notes visibles/creables/editables apres redemarrage).
- Eviter les solutions web volatiles (localStorage/IndexedDB) -> stockage disque (SQLite) uniquement.
- Garder **les memes requetes** cote client (API proche de l’actuelle), bascule online/offline transparente.
- Ajouter un **serveur local allege** (loopback) + **sync bidirectionnelle** avec le serveur distant.
- Priorite #1: **pouvoir tester/debugger sans GUI** (logs + inspection DB + scenarii reproduisibles).

## Contexte repo
- Monorepo: `app/` (React/Vite/Tauri), `server/` (Node/Express + tRPC), `shared/` types.
- Client appelle `api.notes.*` via `app/src/lib/trpc.ts` et `app/src/store/blinkoStore.tsx`.
- Offline existant: `app/src/lib/offlineSqlStore.ts`, `app/src/lib/offlineCache.ts`, `app/src/lib/offlineSync.ts`.
- Risque de divergence: IndexedDB (`offlineCache.ts`) vs SQLite (`offlineSqlStore.ts`).

### Flux actuel (a tracer et documenter)
1. UI -> `api.notes.*` (tRPC client) -> serveur distant.
2. Si offline/erreur reseau -> fallback local (cache/queue).
3. Sync: `offlineSync.ts` pousse les notes en attente.
4. Persistence: DB locale (SQLite) + traces eventuelles (logs).

## Hypotheses
- Nous choisissons **une seule approche**: serveur local allege + SQLite (meme sur mobile).
- L’app desktop/mobile peut lancer un service local (Rust/Tauri) en meme temps que l’UI.
- Le client ne doit pas connaitre la source (remote vs local) -> routing interne.
- Les operations critiques: `notes.list`, `notes.detail`, `notes.upsert`, `notes.delete`, `notes.listByIds`, `tags.list`.

## Scope
### Inclus
- Serveur local allege (loopback) expose API minimale compatible avec le client.
- Stockage SQLite local (notes, tags, queue sync, meta).
- Sync bidirectionnelle (pull/push) avec retries.
- Bascule online/offline fiable (detecter reseau vs erreurs applicatives).
- Outils de test sans GUI + logs persistants.

### Exclu (phase 1)
- Sync complet des pieces jointes/attachments.
- Resolution de conflits avancee (LWW simple au debut).
- API avancées (AI, analytics, partage) en offline.

## Plan technique (approche unique)
### 1) Stabiliser l’observabilite (objectif #1: tester)
- Ajouter un mode **headless** (lancer l’app sans GUI) + logs standardises.
- Ajouter un switch `OFFLINE_DEBUG=1` (ou equivalent) pour logs sync/SQL/HTTP.
- Ajouter un script de diagnostic: dump DB locale + etat sync + derniere erreur.

### 2) Normaliser la persistence locale
- Supprimer/neutraliser IndexedDB (`offlineCache.ts`) pour desktop/mobile.
- Baser toute persistence sur SQLite (`offlineSqlStore.ts`) + schema unique.
- Assurer un format `user_id` unique (string normalise) pour requetes.

### 3) Serveur local allege (loopback)
- Creer un service local (Rust/Tauri) expose via `http://127.0.0.1:<port>`.
- Implementer un subset d’API avec payloads identiques (ou adaptateur) :
  - `notes.list`, `notes.detail`, `notes.listByIds`, `notes.upsert`, `notes.delete`
  - `tags.list` (minimum pour filtres UI)
- Auth locale simple (token local genere et stocke en dur).

### 4) Layer de routage unique cote client
- Remplacer l’actuel fallback multi-tech par un **routeur unique**:
  - Online => remote tRPC
  - Offline => local server (HTTP)
- Garder les memes methodes `api.notes.*` pour l’UI.

### 5) Sync bidirectionnelle (local <-> distant)
- Pull delta: recupere modifications serveur depuis `lastSyncAt`.
- Push queue locale: notes crees/editees offline.
- Garantir idempotence + mapping localId -> remoteId.
- Mettre a jour cache local apres sync.

### 6) Android (service local + sync)
- Lancer le serveur local en background/foreground.
- Utiliser WorkManager/foreground service pour la sync.
- Configurer permissions + lifecycle mobile.

## Checklist (executable)
- [ ] Cartographier les endpoints notes utilises par l’UI (`app/src/store/blinkoStore.tsx`, `app/src/lib/trpc.ts`).
- [ ] Lister le schema SQL local actuel et normaliser `user_id` + meta sync.
- [ ] Prototyper un serveur local minimal (loopback) avec 2 endpoints (`notes.list`, `notes.upsert`).
- [ ] Ajouter un adaptateur client unique (online/offline) qui route vers remote/local.
- [ ] Implementer `list/detail/listByIds/delete` cote local.
- [ ] Ajouter un worker sync (pull/push) + retries + backoff.
- [ ] Remplacer IndexedDB par SQLite uniquement (desktop + mobile).
- [ ] Ajouter logs persistants + outil CLI de diagnostic.
- [ ] Tester Android: lancement serveur + sync en background.
- [ ] Documenter le flux complet et les points de debug pour les devs suivants.

## Tests / Validation (specifiques)
### Unit
- [ ] `offlineSqlStore`: save/list/detail/delete + user_id normalise.
- [ ] `local server handlers`: payloads notes/tags conformes aux schemas.
- [ ] `sync worker`: push -> remove pending; pull -> merge local.

### Integration
- [ ] Tauri desktop: creer note offline -> fermer/reouvrir -> note visible.
- [ ] Tauri desktop: offline -> repasser online -> note sync remote.
- [ ] Offline indicator: ne passe en offline que sur erreurs reseau.
- [ ] Local server: `notes.list` et `notes.upsert` via HTTP loopback.

### End-to-end (manuel)
- [ ] Desktop mac: avion mode -> creer 3 notes -> restart -> edit -> retour online -> verifier sur serveur distant.
- [ ] Android: lancer app, couper reseau, creer note -> tuer app -> relancer -> note presente -> re-sync.

## Risques
- Divergence payloads local/remote si l’API evolue.
- Conflits d’ID entre notes locales et distantes.
- Android: limitations background (service tue).
- Perfs si sync pull sur gros volume sans delta API.

## Rollout
- Phase 1 (desktop): local server + SQLite + sync minimal notes.
- Phase 2 (mobile): local server + background sync + monitoring.
- Phase 3: optimiser sync delta + attachments.

## Estimation
- Observabilite + diagnostic: 1-2 jours.
- Serveur local + endpoints notes/tags: 3-5 jours.
- Sync bidirectionnelle + mapping IDs: 3-5 jours.
- Android integration + tests: 3-4 jours.
