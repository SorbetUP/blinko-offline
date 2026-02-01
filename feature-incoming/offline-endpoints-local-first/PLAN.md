# Plan — Offline local‑first: analyse complète des endpoints + correction des bugs

## Objectif
- Rendre **tous les endpoints** servis en local via le serveur/proxy local, avec **aucun appel direct** vers le serveur distant.
- Corriger les bugs offline: **mode offline h24**, **notes qui ne chargent pas**, **erreur "The string did not match the expected pattern"**.
- Garder les mêmes appels côté UI (`api.*`) et router tout via le local.

## Contexte repo (scan rapide)
- Proxy local/interception: `app/src/lib/localProxy.ts`
- tRPC client: `app/src/lib/trpcSmartClient.ts`, `app/src/lib/trpc.ts`
- Sync: `app/src/lib/syncWorker.ts`, `app/src/lib/syncConfig.ts`
- Endpoint resolver: `app/src/lib/blinkoEndpoint.ts`
- Store online/offline: `app/src/store/baseStore.ts`
- Serveur distant: `server/index.ts`, `server/routerTrpc/*`, `server/routerExpress/*`
- Audit endpoints existant: `docs/ENDPOINTS.md`
- Script utile: `scripts/offline_endpoint_check.mjs`

> Note: pas de `templates/PLAN_TEMPLATE.md` ni `scripts/create_feature_folder.py` dans ce repo → plan rédigé manuellement.

## Hypothèses
- Le badge "offline" vient de `navigator.onLine` (faux en Tauri) ou d’erreurs locales qui basculent `isOnline=false`.
- L’erreur "pattern" vient d’URLs invalides passées à `new URL()` (base vide/sans scheme).
- Certains endpoints essentiels ne sont pas encore traités en local (config/tags/notifications/attachments/plugins/etc.).

## Scope
### Inclus
- Audit exhaustif des endpoints (tRPC + REST + assets + statiques) et **cartographie locale**.
- Implémentation locale pour **tous** les endpoints utilisés par l’app.
- Stockage local durable (SQLite + fichiers) pour config, tags, notifications, attachments, plugins, users, etc.
- Sync distant optionnel (pull/push) derrière le serveur local, jamais en direct.
- Fix des erreurs offline + validation.

### Exclu (si besoin de clarification)
- Fonctionnalités AI/analytics avancées côté distant (sera stub local + sync différé).

## Plan technique (haut niveau)
1) **Audit endpoints**: lister tous les endpoints réellement appelés par l’app (tRPC, REST, assets, plugins) et croiser avec `docs/ENDPOINTS.md`.
2) **Contrat local**: définir pour chaque endpoint un handler local (DB/FS) + format de réponse (même schéma que distant).
3) **Local storage**: compléter les tables locales + index (config/tags/notifications/attachments/plugins/users/etc.).
4) **Proxy strict**: tout `/api/*` doit répondre localement; le distant n’est appelé que par le worker de sync.
5) **Sync**: push/pull en background, sans bloquer l’UI; file d’attente durable.
6) **Fix UI offline**: état online basé sur “local server OK” (pas navigator.onLine). Isoler l’indicateur “sync distant”.
7) **Tests**: scripts CLI/endpoint + offline full + relaunch + corruption résistance.

## Checklist détaillée
- [ ] **Audit endpoints et flux**
  - [ ] Repasser `docs/ENDPOINTS.md` et mettre à jour si manquant.
  - [ ] Extraire les routes client via `rg -n "/api/" app/src` et `rg -n "api\." app/src`.
  - [ ] Lister tRPC (`server/routerTrpc/*.ts`) et REST (`server/routerExpress/**`).
  - [ ] Exécuter `scripts/offline_endpoint_check.mjs` pour vérifier la couverture locale.

- [ ] **État online/offline fiable (Tauri)**
  - [ ] Distinguer **online local** vs **sync distant**.
  - [ ] Empêcher `navigator.onLine` de forcer offline en local.
  - [ ] Logger toute transition `isOnline` (source + raison).

- [ ] **Handlers locaux manquants (ordre critique UI)**
  - [ ] config.* : lecture/écriture locale (SQLite) + cache.
  - [ ] tags.* : CRUD complet + relations note↔tag.
  - [ ] notifications.* : liste + unread count + markAsRead.
  - [ ] attachments.* + `/api/file/*` + `/api/s3file/*` : stockage fichier local + metadata + thumbnails.
  - [ ] plugin.* + `/plugins/*` : gestion locale des plugins + lecture CSS/JS locale.
  - [ ] users.* + `/api/auth/*` : comptes locaux + tokens + profile.
  - [ ] task.* : import/export local (stub si besoin).
  - [ ] comments.*, analytics.*, ai.* : stubs locaux + sync différé (ne doit pas casser l’UI).

- [ ] **Proxy strict local‑first**
  - [ ] Interdire les appels directs vers distant depuis l’UI.
  - [ ] Toute réponse `/api/*` doit être servie localement.
  - [ ] Le distant est appelé **uniquement** par le sync worker (via `__BLINKO_RAW_FETCH`).

- [ ] **Fix erreurs "pattern"**
  - [ ] Normaliser toutes les bases URL avant `new URL()`.
  - [ ] Loguer la valeur brute qui casse (endpoint/base) pour éliminer la source.

- [ ] **Robustesse stockage local**
  - [ ] Migration / normalisation userId + ids offline.
  - [ ] Stratégie de collisions (notes offline vs serverId).
  - [ ] Recovery si DB corrompue (backup & reset contrôlé).

## Tests / Validation
- [ ] **CLI / endpoint smoke**
  - [ ] `bun run tools/blinko-cli` pour lister/ajouter notes locales.
  - [ ] Script `offline_endpoint_check.mjs` doit passer.
- [ ] **Offline full**
  - [ ] App lancée sans serveur distant: UI fonctionnelle, notes visibles, création OK.
  - [ ] Redémarrage app: notes toujours visibles.
  - [ ] Aucune erreur "The string did not match the expected pattern".
- [ ] **Online + sync**
  - [ ] Activer sync, vérifier push/pull sans bloquer l’UI.
  - [ ] Débrancher/rebrancher réseau: pas de blocage, file d’attente OK.

## Risques
- Implémentations locales partielles peuvent casser des vues secondaires.
- Divergence schéma local vs distant si les formats changent.

## Rollout
- Étape 1: endpoints critiques UI (config/tags/notifications/notes/attachments).
- Étape 2: plugins/resources/users/auth local.
- Étape 3: analytics/ai/comments/task (stubs + sync).
- Étape 4: durcissement + logs + tests.

## Estimation (haut niveau)
- Audit + cartographie: 0.5–1j
- Local endpoints critiques: 2–4j
- Reste endpoints + sync: 2–3j
- Tests + stabilisation: 1–2j

