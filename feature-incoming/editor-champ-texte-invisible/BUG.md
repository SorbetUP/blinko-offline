# Bug: champ de texte de l'editeur invisible

## Resume
- Champ de saisie de l'editeur non visible (zone de texte absente).
- Impact direct sur la creation/modification de notes.
- Constat rapporte par l'utilisateur, reproduction non effectuee ici (infos manquantes).

## Comportement observe
- L'editeur s'affiche sans champ d'entree pour taper du texte.
- Le reste de l'UI semble charge (toolbar/zone?).
- Console web: `github-dark.min.css` chargee en `text/html` (MIME incorrect).

## Comportement attendu
- La zone editable (Vditor `.vditor-reset` / `.vditor-content`) doit etre visible et focusable.

## Environnement (a completer)
- Plateforme: [web / desktop Tauri / mobile]
- OS/version: [ex: macOS 14.6 / Windows / Android]
- Mode editeur: [wysiwyg / sv / ir / raw]
- Page: [create / edit / fullscreen]
- Theme: [light / dark]
- Contexte: [offline/online]

## Etapes de reproduction (best effort)
- [ ] Ouvrir l'app Blinko.
- [ ] Ouvrir une note existante OU cliquer sur creer une note.
- [ ] Observer l'editeur: le champ de texte n'est pas visible.

## Diagnostics initiaux
- Fichiers potentiellement impliques:
  - app/src/components/Common/Editor/index.tsx
  - app/src/components/Common/Editor/hooks/useEditor.ts
  - app/src/components/BlinkoEditor/index.tsx
  - app/src/styles/vditor.css
  - app/src/styles/globals.css
- Vditor est monte dans un div `#vditor-${mode}` puis enrichi par `useEditorInit`.
- Le CSS applique un `min-height: var(--min-editor-height)` a `.vditor-reset`.
- Route vditor: `/dist/js/highlight.js/styles/github-dark.min.css` renvoie du HTML (404) au lieu de CSS.

## Hypotheses
- [x] Vditor ne s'initialise pas (assets locaux manquants), laissant un div vide.
- [ ] CSS/height: le conteneur editeur a une hauteur calculee a 0 (flex/overflow/min-height mal resolu).
- [ ] Mauvais mode editeur stocke (ex: `raw` + preview cache + zone editable masquee).
- [ ] Erreur runtime silencieuse dans `useEditorInit` avant le `new Vditor(...)`.
- [ ] Theme/CSS surcharge: texte invisible (couleur identique au background).

## Plan de diagnostic
- [ ] Ouvrir la console dev et relever erreurs (surtout Vditor, import CSS, assets 404).
- [ ] Inspecter le DOM: est-ce que `#vditor-${mode}` contient `.vditor-content` et `.vditor-reset` ?
- [ ] Verifier la hauteur calculee des elements `.vditor`, `.vditor-content`, `.vditor-reset`.
- [ ] Verifier la valeur de `--min-editor-height` et les classes `fullscreen-editor` / `editor-long-text`.
- [ ] Tester les modes view (wysiwyg/sv/ir/raw) via le bouton view mode.
- [ ] Verifier `getBlinkoEndpoint('')` et le chargement des assets Vditor (dist/js).
- [x] Verifie: `Content-Type` incorrect pour `github-dark.min.css` -> fichier introuvable.

## Plan de fix (propose)
- [x] Corriger le chemin des assets Vditor en production (utiliser `appRootProd` au lieu de `__dirname`).
- [x] Restaurer `server/vditor` sur le serveur de prod.
- [ ] Ajouter un guard si Vditor n'est pas initialise (log + fallback visible).
- [ ] Si besoin, copier les assets dans `dist/` lors du build pour eviter les regressions d'empaquetage.

## Tests / validation
- [x] Smoke: `curl -I http://127.0.0.1:1111/dist/js/highlight.js/styles/github-dark.min.css` => `Content-Type: text/css`.
- [ ] Test manuel create: ouvrir l'editeur, texte visible, saisie OK.
- [ ] Test manuel edit: ouvrir une note existante, texte visible, edition OK.
- [ ] Test fullscreen: ouvrir l'editeur plein ecran, champ visible.
- [ ] Test view mode: basculer wysiwyg/sv/ir/raw, champ visible dans tous les modes.
- [ ] Test theme: light/dark, texte lisible.
- [ ] (Optionnel) Ajouter test e2e Playwright/Cypress: assert `.vditor-reset` visible et focusable.

## Notes
- Les templates/scripts `scripts/create_bug_folder.py` et `assets/BUG_TEMPLATE.md` sont absents dans ce repo; le rapport a ete cree manuellement.
- Fix deploye sur le serveur: `server/index.ts` utilise `appRootProd` pour les assets vditor, `server/vditor` restaure, rebuild `dist/index.js`.
