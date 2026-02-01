# Plan: corriger erreurs qe.* + serveur local avec sync

## Objectif
- Corriger les erreurs runtime au demarrage (ex: `undefined is not an object (evaluating 'qe.config.list')`).
- Stabiliser le mode offline (fin du chargement infini) sur desktop/mobile.
- Ajouter un **serveur local** lance avec l’app, qui sert les memes requetes et sync avec le serveur distant.
- Eviter de refaire des builds en boucle: diagnostiquer d’abord, puis corriger, puis valider.

## Contexte repo
- `app/` (React/Vite/Tauri) utilise `api.*` depuis `app/src/lib/trpc.ts`.
- `server/` expose tRPC (`server/routerTrpc/*`).
- Offline actuel: SQLite via `app/src/lib/offlineSqlStore.ts`, cache local, queue sync.
- Modif recente: proxy `api.notes.*` -> localApi, mais **les autres routes restent non‑proxy**.

## Hypotheses (causes probables des erreurs)
- Les erreurs `qe.config.list`, `qe.tags.list`, `qe.notifications.*`, `qe.users.detail`, etc. indiquent que l’objet `api` (minifie en `qe`) **ne contient plus ces sous‑routes**.
- Cause probable: `createApiProxy` dans `app/src/lib/trpc.ts` ne proxyfie que `notes`, le reste est ecrase/incomplet au runtime.
- En offline, la UI attend ces routes au demarrage (config/tags/notifications/plugins/users), mais elles sont `undefined` -> boucle/ecran vide.

## Scope
### Inclus
- Restauration des routes API manquantes.
- Strategie offline claire pour routes non‑notes (config/tags/notifications/plugins/users).
- Serveur local (loopback) qui demarre avec l’app et sync avec le serveur distant.

### Exclu (phase 1)
- Sync complet des pieces jointes/AI/analytics.
- Conflits complexes multi‑device.

## Plan technique

### 1) Diagnostiquer precisement la source `qe.*`
- [ ] Confirmer l’objet `api` exporte apres `createApiProxy`.
- [ ] Lister les appels init au demarrage (config/tags/notifications/plugins/users).
- [ ] Verifier que `api` n’est pas ecrase par un proxy incomplet.

### 2) Corriger les erreurs qe.* (online)
- [ ] Modifier `createApiProxy` pour **preserver toutes les routes** tRPC (config, tags, notifications, plugin, users, etc.), en ne surchargeant que `notes.*`.
- [ ] Ajouter un fallback “no‑op safe” ou erreurs controlees pour routes non disponibles en offline.
- [ ] Garantir que `api.<route>` existe toujours (meme en offline).

### 3) Stabiliser l’offline (fin du chargement infini)
- [ ] Definir quelles routes doivent fonctionner offline (minimum: `notes.*`, `config.list` basique, `tags.list` local).
- [ ] Creer un cache local pour `config`/`tags` (SQLite) ou retourner un stub minimal offline.
- [ ] Empecher la UI de boucler si une route n’est pas disponible (systeme d’etats + timeouts).

### 4) Serveur local (unique voie)
- [ ] Creer un service local (Rust/Tauri ou Node embarque) exposant:
  - `notes.list`, `notes.detail`, `notes.listByIds`, `notes.upsert`, `notes.delete`
  - `tags.list` (minimum), `config.list` (minimum)
- [ ] Demarrer le service automatiquement au lancement de l’app (lifecycle Tauri).
- [ ] Router cote client:
  - Online -> remote tRPC
  - Offline -> local server (memes endpoints)

### 5) Sync bidirectionnelle
- [ ] Push queue locale (notes offline) vers serveur distant quand dispo.
- [ ] Pull delta depuis serveur distant pour mettre a jour SQLite local.
- [ ] Gerer mapping localId -> remoteId.

## Checklist
- [ ] Reproduire les erreurs `qe.*` en online et tracer la route manquante.
- [ ] Corriger `createApiProxy` pour ne pas casser `api.config/tags/notifications/plugin/users`.
- [ ] Ajouter instrumentation des requetes (url/status/duree) pour debug reseau.
- [ ] Implementer fallback offline pour `config.list` et `tags.list` (stub ou cache local).
- [ ] Demarrer un serveur local loopback + API minimale.
- [ ] Ajouter sync worker (pull/push) et logs.

## Tests / Validation
### Unit
- [ ] `api proxy` conserve toutes les routes apres override notes.
- [ ] `offlineSqlStore` OK sur config/tags.

### Integration
- [ ] Online: demarrage sans erreurs `qe.*`.
- [ ] Offline: UI charge sans boucle, notes list OK.
- [ ] Offline: `config.list` et `tags.list` retournent quelque chose.

### E2E
- [ ] Offline -> creer note -> restart -> note toujours presente.
- [ ] Retour online -> sync OK.

## Risques
- Regression si d’autres routes tRPC sont remplacees par erreur.
- Sync incoherente si delta API absent.
- Mobile: service local tue en background.

## Rollout
- Phase 1: correction des erreurs `qe.*` + offline stable.
- Phase 2: serveur local + sync notes.
- Phase 3: tags/config + optimisation.

## Estimation
- Corrections qe.* + offline stable: 1-2 jours.
- Serveur local + sync notes: 3-5 jours.
