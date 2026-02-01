# Security Review: offline local account + remote sync settings

## Scope
- Local account creation/login (offline first) using SQLite and WebCrypto hashing.
- New sync settings UI (remote endpoint + credentials + token storage).
- Sync worker using remote token to push notes.

## Assets / Data
- Local user credentials (username/password) and password hash + salt in SQLite.
- Local auth token (stored in SQLite + localStorage token cache).
- Remote sync token (stored in localStorage).
- Notes and attachments stored locally (SQLite + AppData filesystem).

## Trust Boundaries
- UI <-> Local proxy (trusted).`/api/*` goes through local proxy.
- Local proxy <-> Remote server over network (untrusted).
- Local storage (AppData) is trusted only to the OS user.

## Threat Model (summary)
- Credential theft from localStorage (remote token at rest).
- Weak local auth if hashing or salt generation fails.
- Sync endpoint spoofing / misconfiguration.
- Data leakage through logs or debug output.
- Unauthorized remote sync if endpoint/token mismatch.

## Control Checklist
- [ ] Passwords are hashed locally with PBKDF2 + salt before storage. (`app/src/lib/localAuth.ts`, `app/src/lib/localDb.ts`)
- [ ] Local auth never stores plaintext passwords.
- [ ] Remote token is stored separately from local token; no cross‑mixing.
- [ ] Sync only runs when `syncEnabled` is true and a remote endpoint is set. (`app/src/lib/syncWorker.ts`)
- [ ] Remote calls use raw fetch to bypass local proxy, but are only used by sync paths.
- [ ] Inputs (endpoint, username, password) are validated for non‑empty before sync.
- [ ] No secrets are logged to console.

## Gaps / Risks
- [ ] Remote sync token stored in localStorage (readable by any local malware). Consider moving to OS keychain/secure storage.
- [ ] No TLS enforcement for remote endpoint (user could set http). Should warn or block non‑TLS in UI.
- [ ] No device binding for remote token; theft could allow remote access.
- [ ] Local auth token not a JWT; relies on local trust model only.

## Tests / Validation
- [ ] Register local user offline and verify password login works.
- [ ] Confirm wrong password fails login.
- [ ] Verify sync worker does not run when sync is disabled.
- [ ] Verify remote sync uses remote endpoint only and does not hit local proxy.
- [ ] Validate that remote token is required for sync.
- [ ] Confirm local profile fetch works without remote.

## Rollout / Monitoring
- [ ] Add UI warning for storing remote tokens locally.
- [ ] Add option to clear remote token and disable sync.
- [ ] Add audit log for sync start/stop and failures.

