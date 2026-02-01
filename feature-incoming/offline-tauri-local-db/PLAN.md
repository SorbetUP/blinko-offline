# Plan: offline durable sur desktop mac (stockage disque)

## Objectif
- Rendre le mode offline durable sur desktop mac (Tauri): notes visibles, creation/edition possibles apres fermeture de l'app ou changement de page.
- Eviter localStorage/IndexedDB pour le mode offline desktop; stockage en dur sur disque.
- Definir une architecture offline qui peut aussi couvrir mobile (si possible).

## Contexte repo
- UI: `app/` (React + Vite + Tauri).
- Backend: `server/` (Express + tRPC) expose l'API.
- Offline actuel (web):
  - `app/src/lib/offlineCache.ts` (IndexedDB)
  - `app/src/store/blinkoStore.tsx` (localStorage `offlineNotes` + cache)
  - `app/src/lib/offlineSync.ts`
- Tauri plugins dispo: fs/http/dialog/process, mais pas `tauri-plugin-sql`.

## Hypotheses
- L'app desktop est principalement client-only (elle depend du serveur distant pour les notes).
- `UserStore.id` peut etre indisponible au demarrage offline, ce qui casse la cle du cache local.
- Le besoin principal est la persistence locale durable + sync server.

## Scope
- In: stockage offline durable sur desktop mac, plan de sync, migration du cache web si besoin.
- Out: re-ecriture complete du backend, migration mobile si non supportable par Tauri mobile.

## Choix d'architecture (decision)
### Option retenue: B (SQLite locale dans l'app)
- Unifier desktop + mobile avec une seule architecture offline.
- Eviter localStorage/IndexedDB pour l'app, stockage disque via SQLite.
- Sync geree par l'app (push/pull).

### Option rejetee: A (serveur local embarque)
- Sidecar difficile a supporter sur mobile (Tauri mobile).
- Packaging lourd, maintenance plus complexe.

## Plan technique (propose)
- Etape 0: Decision d'architecture -> Option B.
- Etape 1: Ajouter une couche d'abstraction de stockage offline (interface unique).
- Etape 2: Implementer stockage local disque (SQLite) pour desktop.
- Etape 3: Sync (push/pull) et resolution basique des conflits.
- Etape 4: Migration du cache web existant (one-shot) vers SQLite si present.
- Etape 5: Tests offline + redemarrage + navigation.

## Checklist (Option B: SQLite direct dans l'app)
- [ ] Ajouter `tauri-plugin-sql` (Rust + JS) et configurer SQLite local.
- [ ] Creer schema local: notes, tags, attachments, references, pending_ops, sync_state.
- [ ] Creer `app/src/lib/offlineStore.ts` (interface) + impl SQLite Tauri.
- [ ] Remplacer `offlineCache.ts` + `StorageListState` pour desktop par SQLite.
- [ ] Ajouter migration one-shot depuis IndexedDB/localStorage (si present).
- [ ] Ajouter un pipeline de sync:
  - [ ] push: pending_ops -> API `notes.upsert` etc.
  - [ ] pull: API `notes.list` (ou endpoint delta) -> upsert local.
- [ ] Garde-fous: userId local persiste en dur (pas localStorage).

## Tests / Validation
- [ ] Desktop mac: offline + redemarrage -> notes visibles.
- [ ] Desktop mac: offline + navigation -> notes visibles.
- [ ] Desktop mac: creer/editer offline -> persiste apres redemarrage.
- [ ] Retour online -> sync OK (pas de doublons).
- [ ] (Optionnel) Test e2e: simuler offline + reload + assert notes visibles.

## Risques
- Conflits de donnees sans resolution interactive.
- Sync fragile sans endpoint delta (pull complet).

## Rollout
- Phase 1: feature flag (desktop only) + logs sync.
- Phase 2: migration des caches web existants.
- Phase 3: extension mobile si valide.

## Estimation (ordre de grandeur)
- Option B: 6-12 jours (schema local + sync + migration + UI).
