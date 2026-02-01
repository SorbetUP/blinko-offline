# Bug: mode offline ne persiste pas sur desktop mac (apres fermeture / navigation)

## Resume
- Sur l'app desktop mac (Tauri), le mode offline ne fonctionne plus apres fermeture de l'app ou navigation vers une autre page.
- Les notes ne sont plus visibles, et on ne peut ni creer ni editer.

## Comportement observe
- A l'ouverture initiale, les notes peuvent s'afficher.
- Apres fermeture de l'app ou changement de page, en offline:
  - liste de notes vide
  - creation/edition impossible

## Comportement attendu
- En offline, les notes cachees restent visibles entre redemarrages et navigations.
- La creation/edition offline fonctionne meme apres redemarrage (utilise cache local + queue offline).

## Environnement (connu)
- Plateforme: desktop mac (Tauri)
- Web: impacte egalement (selon retour utilisateur)
- Mobile: non teste

## Etapes de reproduction (best effort)
- [ ] Ouvrir l'app desktop (online) et charger des notes.
- [ ] Passer offline (debrancher reseau).
- [ ] Fermer l'app.
- [ ] Rouvrir l'app en restant offline.
- [ ] Constater que la liste est vide et que l'editeur ne permet plus creation/edition.

## Diagnostics initiaux
- Cache offline utilise IndexedDB par user: `blinko-offline-<userId>`.
- `BlinkoStore.cacheUserId` depend de `UserStore.id`.
- Si `UserStore.id` n'est pas hydrate au demarrage offline, `cacheUserId` devient `''`.
- Dans ce cas, le cache est cherche dans `blinko-offline-` (DB differente) => liste vide.

## Hypotheses
- [ ] `UserStore.id` n'est pas disponible a froid en offline, donc le cache local est lu avec un userId vide.
- [ ] La requete de liste se lance avant l'hydratation du token, puis ne se refresh pas quand l'id arrive.
- [ ] IndexedDB/Storage local non persiste dans le WebView Tauri (moins probable, mais a verifier).
- [ ] L'app retombe sur un etat "logged out" en offline, empechant l'acces au cache utilisateur.

## Plan de diagnostic
- [ ] Logger au demarrage: `UserStore.id`, `cacheUserId`, et taille de `listCachedNotes`.
- [ ] Verifier si `blinkoToken` est bien present dans localStorage apres redemarrage offline.
- [ ] Verifier si un refresh des listes est declenche quand `UserStore.id` devient non-vide.
- [ ] Tester un fallback de cache userId (dernier userId connu en localStorage).

## Plan de fix (propose)
- [ ] Bloquer les requetes offline tant que `UserStore.id` n'est pas hydrate.
- [ ] Ajouter un fallback `cacheUserId` base sur un `lastUserId` persiste.
- [ ] Declencher un refresh des listes quand `UserStore.id` passe de vide a valeur (meme offline).
- [ ] Ajouter un message UI "offline - utilisateur non charge" si `UserStore.id` vide.

## Tests / validation
- [ ] Test desktop mac: offline + redemarrage => notes visibles.
- [ ] Test navigation intra-app (changer de page) => notes persistent.
- [ ] Test creation offline apres redemarrage => note apparait + persiste.
- [ ] Test retour online => sync OK.
- [ ] (Optionnel) Test e2e: simuler offline + reload, assert `.vditor-reset` visible et notes rendues.

## Notes
- Les templates/scripts `scripts/create_bug_folder.py` et `assets/BUG_TEMPLATE.md` sont absents dans ce repo; le rapport a ete cree manuellement.
- Fichiers cibles probables:
  - app/src/store/blinkoStore.tsx
  - app/src/store/user.ts
  - app/src/lib/offlineCache.ts
