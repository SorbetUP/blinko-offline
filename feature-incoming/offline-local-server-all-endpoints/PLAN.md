# Plan: serveur local unique + offline total (tous endpoints via local)

## Objectif
- Corriger les erreurs runtime actuelles (`qe.config.list`, `qe.tags.list`, etc.) et le chargement infini en offline.
- Forcer **100% des appels** de l’app (GUI + futur CLI) à passer par un **serveur local unique** (aucun accès direct au serveur distant).
- Garantir un mode offline **persistant**: notes visibles/créables/éditables après redémarrage, sans stockage web volatil.
- Mettre en place un **sync local<->distant** fiable et testable, tout en laissant le distant uniquement pour sync/fichiers.
- Ajouter des **tests reproductibles** (sans GUI) pour valider chaque endpoint et le mode offline.

## Contexte repo
- Monorepo: `app/` (React/Vite/Tauri), `server/` (Node/Express + tRPC), `shared/` types.
- Client utilise tRPC via `app/src/lib/trpc.ts` et `app/src/store/*`.
- Proxy local present: `app/src/lib/localProxy.ts` (intercepte fetch + axios) et DB locale `app/src/lib/localDb.ts`.
- Endpoint resolver: `app/src/lib/blinkoEndpoint.ts` (Tauri -> `window.location.origin`).
- Doc endpoints existante: `docs/ENDPOINTS.md`.

## Hypotheses
- L’app desktop/mobile peut lancer un **serveur local embarque** (Tauri) accessible en loopback.
- SQLite local (`@tauri-apps/plugin-sql`) est la **source de vérité** en offline.
- Le distant est **optionnel**: uniquement pour sync + fetch fichiers à l’actualisation.
- L’UI ne doit jamais dépendre directement du réseau (pas de spinner bloquant).
- Les scripts de génération/plan (`scripts/create_feature_folder.py`, `templates/PLAN_TEMPLATE.md`) sont absents; on crée le plan manuellement.

## Scope
### Inclus
- Audit + correction des erreurs runtime (`qe.*`) et des appels API qui ne renvoient pas de data.
- Documentation exhaustive des endpoints (tRPC + REST + fichiers) et chemins de données.
- Serveur local unique qui gère **tous** les endpoints utilisés par l’app (tRPC + REST), même en offline.
- Stockage local durable (SQLite + filesystem) + sync best-effort.
- CLI de test (même backend que la GUI) pour valider offline sans UI.
- Batterie de tests automatisés pour valider chaque endpoint en local.

### Exclu (phase 1)
- Optimisations lourdes de sync (delta avancé, conflits complexes).
- Migrations UI / refonte visuelle.
- Synchronisation complète des assets tiers non utilisés par l’app.

## Plan technique (approche unique)
### 0) Stabiliser le socle (stop aux regressions)
- Geler l’archi cible: **tous les appels passent par le serveur local**.
- Repasser en revue les modifications récentes: supprimer/rollback tout ce qui ne sert pas à cette archi.
- Centraliser la “source de vérité” offline dans SQLite + filesystem.

### 1) Cartographie & doc endpoints (obligatoire)
- Regenerer/valider `docs/ENDPOINTS.md` avec la liste tRPC + REST + fichiers.
- Ajouter un tableau “client -> endpoint -> local handler -> source data”.
- Lister explicitement les endpoints indispensables à l’UI (notes, tags, config, users, notifications, attachments, auth).

### 2) Corriger les erreurs `qe.*` et l’initialisation API
- Tracer l’origine de `qe` (bundle) et l’init `api` dans `app/src/lib/trpc.ts`.
- Verifier que les reponses locales tRPC respectent strictement le format attendu (`{ result: { data } }` + superjson).
- Corriger les imports tRPC (ex: `observable`) et verifier la compatibilité avec la version `@trpc/client`.
- Ajouter des protections pour que les stores n’accèdent pas à `api.*` tant que le proxy local n’est pas prêt.

### 3) Serveur local unique (proxy local complet)
- Assurer que **toutes** les routes `/api/*`, `/api/trpc/*`, `/api/v1/*`, `/api/file/*`, `/api/s3file/*` passent par `localProxy`.
- Interdire tout appel direct au distant (meme si `navigator.onLine === true`).
- Router toutes les routes tRPC vers des handlers locaux (notes, config, tags, etc.).
- Pour les fichiers: local en lecture/écriture, et fetch distant **uniquement via** le serveur local.

### 4) Persistence locale complète
- Normaliser le schema SQLite pour **tous** les endpoints nécessaires (notes, tags, config, users, notifications, attachments).
- Stocker les metadata, auth, userId normalisé dans `meta`/`cached_trpc`.
- Pour les fichiers: utiliser un dossier app-data local, avec index dans SQLite.

### 5) Sync local <-> distant (best-effort)
- File d’attente des mutations (create/update/delete) dans SQLite.
- Worker de sync périodique (desktop + mobile) qui pousse vers distant **quand disponible**.
- Pull distant pour refresh local (option: depuis `lastSyncAt`).
- Conflits: stratégie LWW simple en phase 1.

### 6) CLI de test (même backend que la GUI)
- Ajouter un CLI `blinko-cli` qui appelle **exactement** les memes endpoints locaux.
- Scenarios: lister notes, creer note, modifier note, simuler offline, relancer et verifier persistence.
- CLI doit pouvoir fonctionner sans GUI + en CI (headless).

### 7) Tests & validation offline
- Tests unitaires sur les handlers locaux (notes/tags/config/users).
- Tests d’integration: appels tRPC locaux via fetch (script).`
- Tests E2E headless: lancer app, couper reseau, creer note, restart, verifier notes locales.

## Checklist (executable)
- [ ] Auditer les modifications recentes et supprimer les bouts non-alignes avec “serveur local unique”.
- [ ] Regenerer `docs/ENDPOINTS.md` et verifier la liste tRPC/REST.
- [ ] Mapper “UI -> endpoint -> handler local -> stockage”.
- [ ] Corriger les erreurs `qe.*` via audit tRPC client + response shape + import `observable`.
- [ ] Forcer tout appel HTTP a passer par `localProxy` (blocage strict des appels directs remote).
- [ ] Completer les handlers locaux pour les endpoints critiques (notes/tags/config/users/notifications/attachments).
- [ ] Ajouter stockage local pour config/tags/users/notifications (SQLite + cached_trpc).
- [ ] Ajouter stockage local fichiers + index DB.
- [ ] Implementer sync worker (push/pull + retries).
- [ ] Ajouter CLI offline et scripts de test headless.
- [ ] Documenter le flux complet + guide debug pour les devs suivants.

## Tests / Validation (specifiques)
### Unit
- [ ] `localDb`: insert/select/update/delete notes + user_id normalise.
- [ ] `localProxy.handleLocalTrpc`: renvoie des payloads conformes superjson.
- [ ] `localProxy.handleLocalApi`: `/api/auth/profile`, `/api/v1/*` répondent en offline.

### Integration (script)
- [ ] Script `scripts/offline_endpoint_check.mjs`: tous les endpoints tRPC renvoient une reponse locale sans exception.
- [ ] Script `scripts/offline_smoke_cli.mjs`: creer note -> lister -> relire -> restart -> relire.

### End-to-end (desktop/mac)
- [ ] Lancer app sans reseau -> UI charge -> notes locales visibles.
- [ ] Creer note offline -> redemarrer -> note toujours présente.
- [ ] Repasser online -> sync -> note visible sur serveur distant.

## Risques
- Divergence payloads local/remote si l’API evolue.
- Conflits de données (IDs) pendant sync.
- Performances en gros volume sans delta sync.
- Tauri build prompts/signing bloquants (CI/local).

## Rollout
- Phase 1: local server complet + offline notes/tags/config/users + CLI tests.
- Phase 2: sync complet + attachments + verif offline sur mobile.
- Phase 3: optimisation sync, gestion conflits avancee.

## Estimation
- Audit/rollback + doc endpoints: 1-2 jours.
- Local handlers complets + persistance: 3-5 jours.
- Sync worker + queue: 3-4 jours.
- CLI + tests headless: 2-3 jours.
