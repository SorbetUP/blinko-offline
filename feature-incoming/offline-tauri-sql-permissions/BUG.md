# Bug: offline Tauri ne sauvegarde pas (notes vides + mode offline force)

## Resume
- Sur desktop mac, les notes offline ne se sauvegardent pas et la liste reste vide.
- L'UI indique un mode offline meme quand le reseau est OK.
- Hypothese principale: permissions SQL Tauri manquantes, les requetes `execute` echouent => cache/queue vides.

## Comportement observe
- Page liste vide, impossible de creer/editer une note.
- L'UI affiche le mode offline alors que le reseau est actif.
- Erreur possible en console: `undefined is not an object (evaluating 'e.load')` ou erreurs SQL.

## Comportement attendu
- En Tauri, les notes sont cachees localement dans SQLite.
- En offline: on peut creer/editer et retrouver les notes apres redemarrage.
- En online: mode online, sync des notes en attente.

## Environnement (a completer)
- Plateforme: desktop Tauri (macOS)
- Version app: [a completer]
- Version serveur: [a completer]
- Endpoint configure: [a completer]
- Mode: online/offline

## Etapes de reproduction (best effort)
- [ ] Lancer l'app desktop.
- [ ] Ouvrir une note ou creer une note.
- [ ] Couper/repasser le reseau, ou relancer l'app.
- [ ] Constater que la liste est vide et que la note ne se sauvegarde pas.

## Diagnostics initiaux
- L'offline Tauri utilise SQLite via `@tauri-apps/plugin-sql` (`app/src/lib/offlineSqlStore.ts`).
- Les operations d'ecriture passent par `db.execute(...)` (CREATE/INSERT/UPDATE).
- Les permissions SQL Tauri ne sont pas declarees dans `app/src-tauri/capabilities/*.json`.
- Le schema Tauri ACL montre que `sql:default` n'inclut pas `execute`.

## Hypotheses
- [x] Permissions SQL manquantes: `execute` refuse => pas de table ni d'ecriture.
- [ ] Endpoint serveur manquant (tauri://localhost) => appels API echouent et bascule offline.
- [ ] Import plugin SQL non charge dans une build ancienne.

## Fix applique
- Ajout des permissions SQL:
  - `sql:default`
  - `sql:allow-execute`
- Fichiers modifies:
  - `app/src-tauri/capabilities/default.json`
  - `app/src-tauri/capabilities/desktop.json`
  - `app/src-tauri/capabilities/mobile.json`

## Tests / validation (a faire)
- [ ] Rebuild desktop: `cd app && bun run tauri:desktop:build`.
- [ ] Reinstaller l'app (remplacer l'ancien .app).
- [ ] Lancer l'app, creer une note offline, fermer/reouvrir, verifier que la note est toujours la.
- [ ] Repasser online, verifier la sync (note apparait sur le serveur).

## Notes
- Les templates/scripts `scripts/create_bug_folder.py` et `assets/BUG_TEMPLATE.md` sont absents dans ce repo; le rapport a ete cree manuellement.
