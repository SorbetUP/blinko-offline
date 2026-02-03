# API Contract (Local-first MVP)

## HTTP (local API)

### Health
- `GET /health`
  - Response: `{ "ok": true, "version": "local" }`

### Auth
- `POST /api/auth/login`
  - Request: `{ "username": string, "password": string }`
  - Response: `{ "user": { id, name, role, nickname, image }, "token": string }`
- `POST /api/auth/local` (alias)
- `GET /api/auth/profile`
  - Requires `Authorization: Bearer <local_token>`
  - Response: `{ "user": { ... } }`

### Notes
- `GET /api/notes`
  - Response: `{ "data": Note[] }`
- `GET /api/notes/:id`
  - Response: `Note`
- `POST /api/notes`
  - Request: `{ title?, content?, isArchived?, isRecycle?, isShare?, isTop?, type? }`
  - Response: `Note`
- `PUT /api/notes/:id`
  - Request: `{ title?, content?, isArchived?, isRecycle?, isShare?, isTop?, type? }`
  - Response: `Note`
- `DELETE /api/notes/:id`
  - Response: `Note`

### Settings
- `GET /api/settings`
  - Response: `Setting[]`
- `PUT /api/settings`
  - Request: `{ key, value }`
  - Response: `Setting`

### Files / Attachments
- `POST /api/file/upload` (multipart)
  - Field: `file`
  - Response: `{ filePath, fileName, type, size }`
- `POST /api/file/upload-by-url`
  - Request: `{ url }`
- `GET /api/file/:id`
  - Response: file stream
- `DELETE /api/file/:id`

Aliases:
- `POST /attachments`
- `GET /attachments/:id`
- `DELETE /attachments/:id`

### Sync
- `GET /sync/settings`
- `PUT /sync/settings`
- `POST /sync/now`

### tRPC (local compatibility)
- `POST/GET /api/trpc/<procedure>`
  - Supports `notes.*`, `config.*`, `attachments.*`, `tags.*` and safe fallbacks

## Tauri command fallback (no local HTTP)
- `notes_list(input?) -> Note[]`
- `note_get(id) -> Note | null`
- `note_upsert(input) -> Note`
- `note_delete(id) -> { ok: true }`
