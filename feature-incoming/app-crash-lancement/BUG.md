# Bug: crash au lancement (Tauri updater pubkey manquante)

## Resume
- Objectif: corriger le crash immédiat au lancement de l’app.
- Constat: l’app panique au démarrage avec une erreur de config updater (`missing field pubkey`).
- Fix appliqué: réintroduire `plugins.updater.pubkey`, garder `active=false` et `bundle.createUpdaterArtifacts=false` pour éviter la signature.

## Comportement observe
- L’exécutable sort immédiatement.
- Log (stdout):
  - `panic: PluginInitialization("updater", "Error deserializing 'plugins.updater' within your Tauri configuration: missing field pubkey")`

## Comportement attendu
- L’app démarre normalement, même si l’updater est désactivé.

## Environnement
- macOS (Tauri desktop)
- Repo: `blinko-offline`
- Date test: 2026-01-29

## Repro (sans GUI)
1. Lancer `/Applications/Blinko.app/Contents/MacOS/Blinko`.
2. Observer la sortie stderr -> panic “missing field pubkey”.

## Logs / preuves
- `thread 'main' ... PluginInitialization("updater", "... missing field pubkey")`

## Cause racine (probable)
- `tauri_plugin_updater` est initialisé dans `app/src-tauri/src/lib.rs`.
- Quand `plugins.updater.pubkey` est absent du `tauri.conf.json`, la désérialisation du plugin échoue avant même que l’app ne démarre.

## Fix applique
- `app/src-tauri/tauri.conf.json`
  - `plugins.updater.active = false`
  - `plugins.updater.pubkey` réintroduit
  - `bundle.createUpdaterArtifacts = false`

## Plan de fix / checklist
- [x] Restaurer `plugins.updater.pubkey`.
- [x] Garder `plugins.updater.active=false`.
- [x] Mettre `bundle.createUpdaterArtifacts=false` pour éviter la signature.
- [x] Rebuild `tauri:desktop:build`.
- [x] Réinstaller `/Applications/Blinko.app`.
- [x] Lancer l’app et vérifier qu’elle reste vivante > 10s.

## Tests / validation
- [x] `bun run tauri:desktop:build` terminé sans erreur de signature.
- [x] `open -a /Applications/Blinko.app` -> process reste actif > 10s.
- [ ] (optionnel) test d’ouverture UI + navigation.

## Fichiers cibles
- `app/src-tauri/tauri.conf.json`
- `app/src-tauri/src/lib.rs`
