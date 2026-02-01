# Bug: "The string did not match the expected pattern" + mode offline permanent + notes qui ne chargent pas

## Contexte
- Plateforme: macOS (Tauri desktop)
- Mode: local-first / offline-first avec proxy local + sync
- Symptomes rapportés:
  - Erreurs répétées: "The string did not match the expected pattern."
  - UI affiche "mode offline" en permanence
  - Notes ne chargent pas / chargement infini

## Comportement observé
- L'app démarre mais spamme l'erreur "The string did not match the expected pattern".
- Le badge offline reste affiché même quand l'app est censée être utilisable localement.
- Les notes ne se chargent pas (spinner / liste vide).

## Comportement attendu
- Pas d'erreur "string did not match the expected pattern".
- En local-first, l'app doit rester utilisable sans serveur distant: online = true (local), notes listées depuis la DB locale.

## Repro minimale (best‑effort)
- [ ] Lancer l'app Tauri (macOS).
- [ ] Sans serveur distant, observer la console et l'UI.
- [ ] Voir "mode offline" + erreurs répétées + notes non chargées.

## Logs / erreurs
- "The string did not match the expected pattern." (répété)
- "mode offline h24" (badge offline permanent)

## Hypothèses (priorisées)
- [ ] **URL invalide passée à `new URL()`** (baseURL vide ou sans scheme). Candidats:
  - `app/src/lib/localProxy.ts` (construction `Request` / `safeResolveUrl` / `safeNewUrl`).
  - `app/src/lib/blinkoEndpoint.ts` (endpoint localStorage, base URL sans scheme).
  - `app/src/lib/tauriHelper.ts` (downloadFromLink).
  - `app/src/components/Common/AttachmentRender/audioRender.tsx` (preview URL).
- [ ] **`BaseStore.isOnline` piloté par `navigator.onLine`** (faux en Tauri) ou par erreurs réseau locales ⇒ badge offline permanent.
- [ ] **Proxy local renvoie 503 / erreurs** sur endpoints essentiels ⇒ UI bloque (config.*, tags.*, notifications.* etc.).

## Fichiers impactés (à vérifier)
- `app/src/lib/localProxy.ts`
- `app/src/lib/blinkoEndpoint.ts`
- `app/src/store/baseStore.ts`
- `app/src/lib/trpcSmartClient.ts`
- `app/src/components/Common/AttachmentRender/audioRender.tsx`
- `app/src/lib/tauriHelper.ts`

## Plan d’isolation
- [ ] Ajouter un log ciblé qui affiche **l’URL fautive** quand l’exception "pattern" survient (valeur raw + base).
- [ ] Vérifier les valeurs stockées dans `localStorage` (`blinkoEndpoint`, sync endpoint).
- [ ] Lancer l’app sans serveur distant et confirmer que **toutes les requêtes /api/** sont servies localement.
- [ ] Vérifier que `BaseStore.isOnline` ne se met pas à false sur erreurs locales.

## Plan de fix (checklist)
- [ ] Normaliser toutes les bases URL (ajout scheme `http://` si absent, trim, fallback safe) avant `new URL()`.
- [ ] Empêcher `navigator.onLine` d’imposer offline en Tauri (online par défaut en local-first, sync séparé).
- [ ] S’assurer que les endpoints critiques (config/tags/notifications/etc.) ont une réponse locale stable.
- [ ] Ajouter un fallback si `blinkoEndpoint` / `syncEndpoint` est vide ou invalide.

## Tests / validation
- [ ] Lancer `/Applications/Blinko.app` **sans serveur distant** → pas d’erreur "pattern".
- [ ] UI: badge offline **non** affiché, notes listées localement.
- [ ] App fermée/reouverte → notes toujours visibles (DB locale).
- [ ] Sync désactivé → aucune requête réseau bloquante.
- [ ] Ajouter tests unitaires:
  - [ ] `normalizeEndpoint()` / `safeResolveUrl()` (URL vide, sans scheme, malformée).
  - [ ] `BaseStore.isOnline` en environnement Tauri.

## Risques / rollback
- [ ] Modifs sur URL parsing peuvent masquer un bug réel de configuration d’endpoint.
- [ ] Offline/online UI peut diverger de l’état réseau réel. Prévoir un indicateur séparé de sync.

## Notes
- Aucun script `scripts/create_bug_folder.py` ni template `assets/BUG_TEMPLATE.md` trouvé dans ce repo; rapport rédigé manuellement.
