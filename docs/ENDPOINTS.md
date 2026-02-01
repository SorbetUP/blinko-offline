# Endpoints et flux client/serveur (audit complet)

Ce document liste tous les endpoints presents dans le code (serveur + client) et decrit comment l'app communique avec le serveur distant et le serveur local (Tauri). Objectif: RIEN ne passe directement par le serveur distant; tout doit passer par le proxy/local-server.

## Sources verifiees (code)
- Serveur HTTP: `server/index.ts`
- tRPC routers: `server/routerTrpc/*.ts`
- Express routers: `server/routerExpress/**`
- App client: `app/src/**` (requetes explicites)
- Proxy local: `app/src/lib/localProxy.ts`
- Endpoint resolver: `app/src/lib/blinkoEndpoint.ts`

## Base URLs / points d'entree
- UI (Tauri): `window.location.origin` (assets locaux empaquetes)
- API tRPC: `POST /api/trpc/<router>.<procedure>`
- OpenAPI auto: `GET /api/*` (meme router tRPC expose en REST par trpc-to-openapi)
- Auth: `GET/POST /api/auth/*`
- Fichiers: `GET/POST /api/file/*`, `GET /api/s3file/*`
- Plugins statiques: `GET /plugins/*`
- RSS: `GET /api/rss/:userId/{rss|atom}`
- OpenAI compat: `POST /v1/chat/completions`
- MCP: `GET /sse`, `POST /messages`
- Health: `GET /health`

## tRPC endpoints (server/routerTrpc)
Chemin d'appel: `/api/trpc/<router>.<procedure>`

### ai
- AIComment
- autoEmoji
- autoTag
- batchCreateModelsFromProvider
- completions
- createModel
- createModelsFromProvider
- createProvider
- deleteModel
- deleteProvider
- embeddingDelete
- embeddingInsertAttachments
- embeddingUpsert
- fetchProviderModels
- getAllModels
- getAllProviders
- getModelsByCapability
- getModelsByProvider
- rebuildEmbeddingProgress
- rebuildEmbeddingResume
- rebuildEmbeddingRetryFailed
- rebuildEmbeddingStart
- rebuildEmbeddingStop
- rebuildingEmbeddings
- speechToText
- summarizeConversationTitle
- testConnect
- updateModel
- updateProvider
- writing

### aiTask
- create
- delete
- list
- runNow
- toggle

### analytics
- dailyNoteCount
- monthlyStats

### attachments
- createFolder
- delete
- deleteMany
- list
- move
- rename

### comments
- create
- delete
- list
- update

### config
- ai
- getPluginConfig
- list
- setPluginConfig
- update

### conversation
- clearMessages
- create
- delete
- detail
- list
- publicDetail
- toggleShare
- update

### follows
- follow
- followFrom
- followList
- followerList
- isFollowing
- recommandList
- unfollow
- unfollowFrom

### fonts
- create
- delete
- getByName
- getFontData
- list
- update
- upload

### mcpServers
- connectionStatus
- create
- delete
- disconnect
- get
- getTools
- list
- testConnection
- toggle
- update

### message
- clearAfter
- create
- delete
- list
- update

### notes
- addReference
- clearRecycleBin
- dailyReviewNoteList
- deleteMany
- detail
- getInternalSharedUsers
- getNoteHistory
- getNoteVersion
- internalShareNote
- internalSharedWithMe
- list
- listByIds
- noteReferenceList
- publicDetail
- publicList
- randomNoteList
- relatedNotes
- reviewNote
- shareNote
- trashMany
- updateAttachmentsOrder
- updateMany
- updateNotesOrder
- upsert

### notifications
- create
- delete
- list
- markAsRead
- unreadCount

### plugin
- getAllPlugins
- getInstalledPlugins
- getPluginCssContents
- installPlugin
- saveAdditionalDevFile
- saveDevPlugin
- uninstallPlugin

### public
- hubList
- hubSiteList
- latestClientVersion
- latestServerVersion
- linkPreview
- musicMetadata
- oauthProviders
- serverVersion
- siteInfo
- testHttpProxy
- testWebhook

### tags
- deleteOnlyTag
- deleteTagWithAllNote
- fullTagNameById
- list
- updateTagIcon
- updateTagMany
- updateTagName
- updateTagOrder

### task
- exportMarkdown
- importFromBlinko
- importFromMarkdown
- importFromMemos
- list
- upsertTask

### users
- canRegister
- deleteUser
- detail
- genLowPermToken
- genTokenByUserId
- generate2FASecret
- linkAccount
- list
- login
- nativeAccountList
- publicUserList
- regenToken
- register
- unlinkAccount
- upsertUser
- upsertUserByAdmin
- verify2FAToken

## Express/REST endpoints (server/routerExpress)
Chemin d'appel: montes dans `server/index.ts`.

### Auth (`/api/auth/*`)
- GET `/api/auth/github`
- GET `/api/auth/callback/:providerId`
- GET `/api/auth/google`
- GET `/api/auth/facebook`
- GET `/api/auth/twitter`
- GET `/api/auth/discord`
- POST `/api/auth/login`
- POST `/api/auth/verify-2fa`
- GET `/api/auth/profile`
- GET `/api/auth/:providerId`
- POST `/api/auth/logout`
- GET `/api/auth/validate-token`

### Fichiers
- POST `/api/file/upload`
- POST `/api/file/upload-by-url`
- POST `/api/file/delete`
- GET `/api/file/*` (stream fichier local + thumbnails)
- GET `/api/s3file/*` (stream S3 + thumbnails)

### Plugins statiques
- GET `/plugins/*` (fichiers JS de plugins)

### RSS
- GET `/api/rss/:userId/rss`
- GET `/api/rss/:userId/atom`

### OpenAI compat
- OPTIONS `/v1/chat/completions`
- POST `/v1/chat/completions`

### MCP
- GET `/sse`
- POST `/messages`

### OpenAPI
- GET `/api/openapi.json`
- UI swagger `/api-doc`
- REST expose via `/api/*` (openapi = tRPC)

### Health
- GET `/health`

## Assets locaux / statiques (serveur)
Servis par `express.static` sur `public` + routes speciales Vditor:
- `/dist/js/...` (mermaid, echarts, highlight, katex, etc.)
- `/dist/js/highlight.js/styles/github.min.css`
- `/dist/js/highlight.js/styles/github-dark.min.css`
- `/locales/*` (i18n)
- `/loading.gif`

## Endpoints references par le client (app/src)
- `/api/trpc` (tRPC)
- `/api/auth/login`, `/api/auth/profile`, `/api/auth/verify-2fa`, `/api/auth/logout`
- `/api/file/upload`, `/api/file/upload-by-url`, `/api/file/delete`
- `/api/v1/comment/*` et `/api/v1/note/public-list` (openapi)
- `/api/rss/:id/atom`
- `/api-doc` (docs)
- Assets: `/locales/*`, `/loading.gif`, `/dist/js/*`

## Flux de communication (client <-> local <-> distant)
### Regle actuelle (Tauri)
- `getBlinkoEndpoint()` -> toujours `window.location.origin` (donc pas d'acces direct au distant)
- `localProxy` intercepte TOUT `fetch` + axios
- `/api/*` passe par le proxy local
- `/api/trpc/notes.*` -> local DB (offline-first)
- autres `/api/trpc/*` -> proxy vers distant avec cache/fallback
- `/api/auth/profile` -> local (token store) en offline

### Reste a deplacer vers le local server (TODO)
Tout ce qui n'est pas local-first aujourd'hui:
- `tags.*`, `config.*`, `notifications.*`, `plugins.*`, `attachments.*`, `resources.*`, `comments.*`, `analytics.*`, `ai.*`, etc.
- REST: `/api/file/*`, `/api/s3file/*`, `/api/rss/*`, `/v1/chat/completions`, `/sse`.

Objectif final: tous ces endpoints doivent passer par un server local qui:
1) sert les reponses en local (DB/FS),
2) synchronise en background avec le distant si disponible.

## Comment verifier a nouveau (commandes)
- tRPC routers: `server/routerTrpc/*.ts`
- Express: `server/routerExpress/**` + `server/index.ts`
- Client: `rg -n "/api/" app/src`
- Listes tRPC extraites par regex (outil interne): `python3 - <<'PY' ...` (script utilise lors de cet audit)
