# Plan: Mode offline (mobile + PC)

## Objectif
Mettre en place un mode offline robuste pour l'app Tauri (desktop + Android), permettant la consultation et l'edition des notes hors ligne, avec synchronisation fiable lorsque la connexion revient.

## Contexte repo
- Monorepo Bun/Turbo: `app/` (React + Vite + Tauri), `server/` (Express + tRPC), `shared/` (types).
- Offline partiel deja present: `app/src/store/blinkoStore.tsx` stocke des notes offline dans `localStorage` et les merge dans les listes.
- Detection online/offline via `BaseStore.isOnline` (`app/src/store/baseStore.ts`).
- PWA configuree dans `app/vite.config.ts`, mais desactivee pour les builds Tauri via `app/src-tauri/tauri.conf.json` (`build:no-pwa`).
- API client tRPC via `app/src/lib/trpc.ts` (endpoint `/api/trpc`).
- Route `/_offline` referencee dans `App.tsx`, mais aucune page explicite trouvee.

## Hypotheses
- Le besoin vise les builds Tauri (desktop + Android). Le web/PWA reste optionnel.
- L'offline doit couvrir au minimum: lecture listes/detail notes, creation, edition, suppression (ou mise a la corbeille), tags de base.
- Les ressources/attachments offline sont souhaitables mais peuvent etre phasees (telechargement sur demande).
- Auth/permissions restent cote serveur; hors ligne on utilise un cache local par compte + endpoint.

## Scope
Inclus:
- Stockage local persistant (notes, tags, references, metadata, files en attente d'upload).
- Moteur de sync (queue d'operations + pull de changements) avec gestion de conflits.
- UI: statut offline, indicateur de sync, actions manual sync.

Exclus (phase 1):
- IA offline, partage public, analytics offline complets.
- Synchronisation temps reel multi-device (on reste sur sync pull/push periodique).

## Plan technique
1) Cartographier les flux data et surfaces UI
- Identifier tous les stores qui lisent/ ecrivent notes, tags, attachments (BlinkoStore, ResourceStore, TagStore, Editor).
- Lister les ecrans critiques (home/list, detail, editor, resources) et les attentes offline.

2) Concevoir une couche de stockage offline unifiee
- Interface `OfflineRepository` (notes/tags/attachments + syncQueue + metadata).
- Implementation Tauri via SQLite (ex: `@tauri-apps/plugin-sql`) et stockage fichiers via `@tauri-apps/plugin-fs` (appDataDir).
- Migration de `StorageListState` (offlineNotes) vers la DB locale.
- Structurer les tables (notes, tags, notes_tags, attachments, references, pending_ops, sync_state, local_files).

3) Ajouter une strategie de synchronisation
- Push: traiter `pending_ops` quand online (create/update/delete note, tags, attachments).
- Pull: endpoint serveur de type `notes.sync` (since timestamp + deletions) et equivalents pour tags/attachments.
- Conflits: stocker `updatedAt` local + server; appliquer une politique (last-write-wins ou resolution manuelle via UI).
- Reconciler les IDs (local temp -> server id) et mettre a jour references/attachments.

4) Adapter les stores et le client API
- Modifier `BlinkoStore.getFilteredNotes` pour lire le cache local en offline, et pour hydrater/mettre a jour le cache en online.
- Intercepter `upsertNote` pour creer des operations locales si offline, et declencher sync si online.
- Ajouter un service `SyncService` (timer + events `online/offline` + retry/backoff) dans `initStore`.

5) Offline pour attachments
- Offline create: copier les fichiers dans `appDataDir` et marquer `pending_upload`.
- Online sync: uploader, remplacer les chemins locaux par les URLs serveur, et mettre a jour la note.
- Optional: cache des ressources (telechargement sur demande + purge LRU).

6) UI/UX offline
- Badge global offline + etat sync (ex: en-tete `CommonLayout`).
- Afficher l'etat `pendingSync` sur les notes offline (existant: `BlinkoCard` affiche `isOffline`).
- Ecran d'erreurs de sync + bouton "Reessayer" + option "Conflits".

7) Ajustements serveur (tRPC)
- Ajouter endpoints `notes.syncChanges`, `tags.syncChanges`, `attachments.syncChanges` (since + pagination + deletedIds).
- Garantir `updatedAt` et `deletedAt` coherents pour les deltas.

8) Tests et validation
- Tests unitaires sur la queue de sync et la reconciliation des IDs.
- Tests manuels: creer/editer offline, redemarrer l'app, repasser online, verif server + conflits.

## Checklist
- [ ] Cartographier les flux note/tag/attachment dans `app/src/store/*`.
- [ ] Specifier le schema SQLite local + migrations offline.
- [ ] Creer `OfflineRepository` + implementation Tauri SQLite.
- [ ] Creer `SyncService` (push + pull + backoff + monitoring).
- [ ] Ajouter endpoints tRPC de delta sync cote serveur.
- [ ] Integrer lecture offline dans `BlinkoStore` (list/detail/search) + fallback online.
- [ ] Gerer attachments offline (stockage local + upload differe).
- [ ] Ajouter UI d'etat offline/sync + ecran conflits.
- [ ] Ajouter tests unitaires + plan de tests manuels.

## Tests / Validation
- `bun run dev:frontend` + couper reseau, verifier creation note offline.
- Reconnecter, verifier sync (note apparait serveur), aucune duplication.
- Redemarrer l'app offline, verifier persistance locale.
- Tester attachements offline -> upload au retour reseau.

## Risques
- Conflits multi-device non resolus (risque de perte de donnees).
- Stockage local volumineux (Android/desktop) et gestion de purge.
- Divergence entre data locale et serveur si endpoints delta incomplets.

## Rollout
- Derriere un feature flag (ex: `offlineModeEnabled`).
- Phase 1: offline notes sans attachments.
- Phase 2: attachments + conflits UI.
- Phase 3: optimisation perf + purge/cache.

## Estimation
- Cadrage + schema: 1-2 jours.
- Offline repo + sync: 4-7 jours.
- UI + attachments + stabilisation: 3-5 jours.

