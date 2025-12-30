# Repository Guidelines

## Project Structure & Module Organization
- `app/`: React + Vite frontend and Tauri desktop client.
  - `app/src/`: UI, routes, and client-side logic.
  - `app/src-tauri/`: Tauri config and Rust shell.
  - `app/tauri-plugin-blinko/`: Custom Tauri plugin.
- `server/`: Node/Express + tRPC backend, AI services, and jobs.
- `shared/`: Cross-package utilities and shared types.
- `prisma/`: Database schema, migrations, and seed scripts.
- `blinko-types/`: Published type definitions.
- Deployment assets: `docker-compose*.yml`, `dockerfile`, and `helm/`.

## Build, Test, and Development Commands
- `bun install`: Install dependencies for the monorepo.
- `bun run dev`: Run the Tauri desktop app in dev mode.
- `bun run dev:backend`: Start only the backend (Turbo filter).
- `bun run dev:frontend`: Start only the frontend (Turbo filter).
- `bun run build:web`: Build the web frontend.
- `bun run prisma:generate`: Generate the Prisma client.
- `bun run prisma:migrate:dev`: Apply dev migrations.
- `bun run prisma:studio`: Open Prisma Studio.
- `bun run test`: Run tests via Turbo (only packages with test scripts).
- `docker-compose -f docker-compose.prod.yml up -d`: Run production stack via Docker.

## Coding Style & Naming Conventions
- TypeScript-first codebase; use `bun` and `turbo` for scripts.
- Match local conventions when editing files (indentation, imports, order).
- Follow existing file and folder conventions (PascalCase for React components, camelCase for utilities).
- Prefer colocated component files in `app/src/` and shared types in `shared/` or `blinko-types/`.

## Testing & Verification
- Tests are executed with `bun run test` (Turbo). If adding tests, match the conventions of the package you touch.
- When no automated tests exist, note manual verification steps.

## Commit & Pull Request Guidelines
- Commit history uses Conventional Commits (e.g., `feat:`, `fix:`, `refactor:`, `chore:`) and occasional `[ci skip]` tags.
- PRs should include a concise summary, linked issues, and screenshots or screen recordings for UI changes.
- Call out schema or migration changes explicitly and note the related `prisma` commands.

## Configuration & Secrets
- Create a root `.env` with at least `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`.
- Optional integrations include S3 and AI provider keys; keep secrets out of version control.
- For private operational notes, use `AGENTS.local.md` (gitignored).
