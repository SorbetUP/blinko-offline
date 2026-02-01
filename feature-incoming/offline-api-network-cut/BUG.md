# Bug: requetes API + bascule offline lors coupure reseau

## Resume
- Objectif: observer les requetes API cote client, simuler une coupure reseau, verifier la bascule offline et la lecture du cache.
- Constat: les logs Tauri ne montrent pas les requetes HTTP, mais `offline-debug.log` confirme que l’appel `notes.list` echoue puis bascule en offline et lit le cache SQLite.

## Comportement observe
- Les requetes API passent par `app/src/lib/trpc.ts` -> `getLinks()` -> `httpBatchLink/httpBatchStreamLink` vers `getBlinkoEndpoint('/api/trpc')`.
- Quand l’endpoint est rendu inaccessible, `getFilteredNotes` loggue une erreur (Load failed / timeout) puis passe en offline.
- Les logs stdout de l’app (Tauri) ne montrent pas les requetes HTTP (pas de trace reseau visible).

## Comportement attendu
- Possibilite de voir clairement chaque requete API (url, methode, status, duree) dans les logs de debug.
- Lors coupure reseau, bascule offline + lecture cache doit etre visible + deterministic.

## Environnement
- Desktop macOS (Tauri)
- Repo: `blinko-offline`
- Date test: 2026-01-26

## Repro (sans GUI)
1. Modifier `blinkoEndpoint` (localStorage WebKit) -> `http://10.255.255.1:1111` (endpoint non routable).
2. Lancer `Blinko.app` en headless pendant ~10s.
3. Lire `~/Library/Application Support/com.blinko.app/offline-debug.log`.

## Logs / preuves
- `offline-debug.log` montre:
  - `getFilteredNotes online start...`
  - `getFilteredNotes online error: Load failed` ou `timeout`
  - `getFilteredNotes offline start...`
  - `listCachedNotes ... rows=28`
  - `getFilteredNotes offline end ... returned=14`

## Analyse des requetes
- Points d’entree:
  - `app/src/lib/trpc.ts` (createTRPCClient + httpBatchLink/httpBatchStreamLink)
  - `app/src/store/blinkoStore.tsx` (utilise `api.notes.list/detail/upsert`)
- Quand offline:
  - `app/src/lib/trpc.ts` route vers `localNotesApi` si `shouldUseLocalNotesApi()`.
  - `app/src/lib/localApi.ts` lit le cache SQLite via `offlineSqlStore`.

## Hypotheses
- L’absence de logs reseau empeche d’identifier les erreurs exactes (DNS, timeout, 401, etc.).
- Les requetes sont bien lancees, mais le diagnostic reste aveugle (aucun traceur HTTP).

## Plan de fix (instrumentation)
- [ ] Ajouter un wrapper `fetch` dans `getLinks()` pour logguer `url`, `status`, `duration`, `error`.
- [ ] Ajouter un flag `OFFLINE_DEBUG=1` (ou `localStorage`) pour activer logs reseau.
- [ ] Logguer la raison de bascule offline (timeout vs network error vs 401).
- [ ] Exporter un mini rapport (dernieres 100 req) dans un fichier local.

## Tests / Validation
- [ ] Simuler endpoint down -> logs montrent `status=ERR_NETWORK` + bascule offline.
- [ ] Endpoint up -> logs montrent `200` + pas de bascule.
- [ ] Timeout artificiel -> logs montrent `timeout` + fallback offline.

## Fichiers cibles probables
- `app/src/lib/trpc.ts`
- `app/src/lib/blinkoEndpoint.ts`
- `app/src/store/baseStore.ts`
- `app/src/store/blinkoStore.tsx`
