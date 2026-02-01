# Bug: offline permanent + "The string did not match the expected pattern" + notes non chargées

## Contexte
- Plateforme: macOS (Tauri)
- Mode: local‑first (proxy local + DB SQLite + sync optionnel)
- Demande: **diagnostic très long** + **test de tous les endpoints utilisés** + **fixes**

## Observé
- Erreur répétée: `The string did not match the expected pattern.`
- Badge "offline" affiché en permanence (mode offline h24)
- Liste des notes vide / chargement infini

## Attendu
- Aucune erreur de pattern URL
- UI utilisable sans serveur distant (local-first), notes persistantes
- Online/offline UI reflète seulement la sync distante, pas le local

## État actuel (preuves / résultats)
- Audit endpoints: `docs/ENDPOINTS.md` (liste complète tRPC + REST)
- Extraction des appels dans l’app: `rg -n "api\." app/src`
- Script de couverture locale: `scripts/offline_endpoint_check.mjs`
  - Résultat: **tRPC OK: 168/168**
  - REST testés: `/api/auth/profile`, `/api/auth/logout`, `/api/v1/comment/list`, `/api/v1/note/public-list` OK
  - Note: `/api/auth/login` renvoie 405 (méthode GET) → normal dans ce test

## Causes probables (priorisées)
1) **URL invalide passée à `new URL()`** (base vide/sans scheme)
   - Sources possibles: `getBlinkoEndpoint`, `syncEndpoint`, preview d’attachments, downloadFromLink, URL de proxy
2) **État online lié à `navigator.onLine`** en Tauri → faux offline permanent
3) **Session locale absente** (`blinkoToken` manquant) → notes non chargées car `userId` vide
4) **Handlers locaux incomplets ou réponses incohérentes** sur endpoints critiques (config/tags/notifications/attachments/plugins)

## Scope du debug (endpoints utilisés par l’app)
### Appels tRPC détectés (extraits, principaux)
- notes.* (list, detail, listByIds, upsert, share, review, etc.)
- config.* (list, update, get/set plugin config)
- tags.* (list, update, delete)
- notifications.* (list, unread)
- attachments.* (list, move, createFolder, delete)
- users.* (detail, list, login/register/upsert/regen)
- task.* (list, upsert)
- plugin.* (getAll, getInstalled, install/uninstall, css)
- ai.*, analytics.*, comments.*, conversation.*, message.*, follows.*, mcpServers.*

### REST / fichiers / assets
- `/api/auth/*`, `/api/file/*`, `/api/s3file/*`, `/api/plugins/*`
- `/api/v1/*` (openapi proxy)
- `/locales/*`, `/dist/js/*`, `/loading.gif`

## Repro (best‑effort)
- [ ] Démarrer l’app Tauri **sans serveur distant**
- [ ] Observer l’erreur "pattern" en console
- [ ] Vérifier badge offline permanent
- [ ] Ouvrir une note / créer une note → chargement infini ou liste vide

## Debug long (checklist exhaustive)
### A) Capturer l’URL fautive (pattern)
- [ ] Ajouter un wrapper global sur `new URL()` (ou remplacer les usages critiques) qui logue `raw`, `base`, `stack` vers `offline-debug.log`
- [ ] Lancer l’app et capturer l’URL fautive exacte
- [ ] Corriger la source (base vide / scheme manquant / value issue)

### B) Vérifier l’état online/offline
- [ ] Logger chaque `setOnlineStatus(...)` et `setOnlineStatusFromError(...)` avec source
- [ ] En Tauri, forcer `isOnline=true` (local‑first) et séparer l’état “sync distant”

### C) Vérifier session locale / userId
- [ ] Vérifier que `blinkoToken` existe au démarrage
- [ ] Si absent et un user local existe, créer `blinkoToken` automatiquement
- [ ] Vérifier que `localNotesService` reçoit un `userId` non vide

### D) Vérifier chaque endpoint utilisé par l’app
- [ ] Exécuter `scripts/offline_endpoint_check.mjs` (tRPC 168/168 OK)
- [ ] Ajouter des tests REST supplémentaires:
  - [ ] `/api/file/upload`, `/api/file/upload-by-url`, `/api/file/delete`
  - [ ] `/api/file/*` (lecture d’un fichier local)
  - [ ] `/api/s3file/*` (lecture mock/local)
  - [ ] `/api/plugins/*` (lecture css/js plugin)
- [ ] Vérifier **local handler** pour chaque famille:
  - [ ] config.*
  - [ ] tags.*
  - [ ] notifications.*
  - [ ] attachments.*
  - [ ] plugin.*
  - [ ] users.*
  - [ ] task.*
  - [ ] ai.*, analytics.*, comments.*, conversation.*, message.*, follows.*, mcpServers.* (fallbacks stubs OK)

### E) Vérifier persistance notes
- [ ] Créer note offline
- [ ] Redémarrer app → note toujours visible
- [ ] Inspecter SQLite dans `~/Library/Application Support/com.blinko.app/blinko_local.db`

## Plan de fix (séquencé)
1) **URL safety globale**
   - [ ] Normaliser toutes les bases URL (ajout scheme, trim) avant `new URL()`
   - [ ] Ajouter logging local sur erreurs URL
2) **Online/offline UI**
   - [ ] Ne plus utiliser `navigator.onLine` en Tauri pour l’UI
   - [ ] Introduire un état séparé `syncOnline` (si nécessaire)
3) **Session locale auto**
   - [ ] Auto‑création de `blinkoToken` si user local existe
   - [ ] Vérifier `userId` disponible avant `notes.list`
4) **Endpoint coverage**
   - [ ] Compléter/aligner toutes les réponses locales (schema compatible)
   - [ ] Vérifier REST file routes + plugins + openapi
5) **Tests / validation**
   - [ ] Script endpoints + smoke offline + relaunch
   - [ ] Ajout tests unitaires URL normalization + baseStore online state

## Tests / Validation (concrets)
- [ ] `bun scripts/offline_endpoint_check.mjs`
- [ ] `bash scripts/smoke_localfirst_macos.sh`
- [ ] CLI local: `cd tools/blinko-cli && bun run start -- local:notes:list`
- [ ] App Tauri offline: créer / fermer / relancer → notes persistantes

## Fichiers impactés (principaux)
- `app/src/lib/localProxy.ts`
- `app/src/lib/blinkoEndpoint.ts`
- `app/src/store/baseStore.ts`
- `app/src/lib/syncWorker.ts`
- `app/src/lib/localDb.ts`
- `app/src/lib/localNotesService.ts`
- `app/src/components/Common/AttachmentRender/*`

## Notes
- Le repo n’a pas `scripts/create_bug_folder.py` ni `assets/BUG_TEMPLATE.md`; rapport créé manuellement.
