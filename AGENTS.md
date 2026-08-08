# Repository Guidelines

Guidance for agentic coding assistants working in this repo. `README.md`
explains what emusync is and how a sync actually works — read it first if you
are touching the sync engine. `deploy/README.md` covers the save-store backup
job. This file is about working in the code.

Keep changes minimal and consistent with existing patterns, and update this
file when tooling or conventions change.

## Invariants

These are not style preferences. Each one was a bug, an outage, or a
deliberate decision that looks like a bug. Do not "fix" them without asking.

- **There is no authentication, on purpose.** The server binds every
  interface and anyone who can reach it can start a sync that overwrites
  saves. It is deployed to a private network only. Do not add auth, and do
  not report its absence as a defect.
- **This code deletes people's save files.** Anything touching
  `app/server/backup.ts` is destructive by nature. Three rules hold there:
  transfer pairs are interleaved, never batched (one failed move must not
  leave several targets already deleted); every filesystem path reaching a
  shell goes through `esc()` — `workDir` included, because it lands in an
  `rm -rf`, and joined paths escaped whole rather than piecewise; and config
  is verified before it is written, not after.
  Know what `esc()` is and is not. It escapes spaces on POSIX and wraps the
  string in double quotes on Windows — that is all. It is a correctness
  guard against paths with spaces deleting the wrong directory, not a
  sanitiser: `;`, backticks and `$()` in a configured path still reach
  `bash`, and `device.ip` and `device.user` are interpolated into `ssh`/`scp`
  strings with no escaping at all. (`device.port` is the one field that is
  safe — `normalizePort` admits only integers 1–65535.) A hostile `db.json`
  can therefore execute commands on the server — and since `/admin` writes
  `db.json` with no authentication, "hostile `db.json`" means anyone who can
  reach the port, not someone who already has a shell. That is accepted only
  because the deployment is a private network; it is not a reason to relax
  it further, and any change that widens what reaches `bash` makes an
  already-reachable hole bigger.
- **Three transfer paths.** Nintendo Switch devices (`os: "nx"`) use FTP,
  chosen by OS in `getSyncTypeForOs` and branched on before anything else —
  that one is deliberate. Everything else goes over ssh, and there the choice
  between rsync and the scp stage-delete-move dance is probed per sync, never
  hard-coded per device or per OS. The rsync flag set is
  chosen to match scp's observable behaviour rather than rsync's defaults;
  the reasoning is commented at `RSYNC_FLAGS` and should be read before
  changing a flag.
- **Job logs are a Redis LIST** at `<jobId>:log`, and `StoredSyncRecord`
  omits `output` so no writer can persist a competing copy. Appending to an
  array inside the record is what this replaced: it was a read-modify-write
  that silently dropped concurrent lines.
- **`eslint.config.js` reads the installed React version** instead of using
  `"detect"`. Reverting that to `"detect"` breaks every ESLint 10 run — the
  plugin's detection path calls an API ESLint 10 removed.

## Project Structure

- Source lives in `app/`: `components/`, `routes/`, `contexts/`, `theme/`,
  `types/`, `utilities/`, `server/`.
- Entry layout is `app/root.tsx`; routes are file-based under `app/routes/`
  with the manifest in `app/routes.ts`.
- Route types are generated into `.react-router/types` (do not edit).
- Server-side helpers live in `app/server/`, shared domain types in
  `app/types/`, server types in `app/server/types.ts`.
- Global styles live in `app/app.css`; static assets in `public/`.
- Build output goes to `build/client` and `build/server`.

## Configuration

- React Router SSR config is in `react-router.config.ts` (SSR stays enabled).
- `vite.config.ts` wires React Router and Tailwind. Path aliases use Vite 8's
  native `resolve: { tsconfigPaths: true }` — the `vite-tsconfig-paths` plugin
  was removed and now warns that it is redundant.
- `vitest.config.ts` is separate and takes precedence for tests. A `test`
  block in `vite.config.ts` is silently ignored.
- The `~/` path alias lives in `tsconfig.json`. `baseUrl` is deliberately
  absent: the relative `paths` mappings do not need it on TypeScript 5.9, and
  leaving it out is what lets the tree compile under TypeScript 7, which
  removed the option outright.
- **TypeScript stays on 5.x, and lint is the reason.** The tree itself is
  already TS 7 clean — verified with `typescript@7.0.2` in a scratch clone,
  where `tsc --noEmit` exits 0. `typescript-eslint` 8.66.0 is what blocks
  the bump: it throws at module load on any TypeScript major >= 7, so
  `bun run lint` dies before reading `eslint.config.js`. The full reasoning
  and the re-test recipe are commented at the `typescript-eslint` import in
  `eslint.config.js`. Upstream issue: typescript-eslint#10940.
- Prettier settings are in `.prettierrc` (`tabWidth: 4`). Note `proseWrap`
  is unset, so Prettier will not rewrap Markdown prose; wrap it yourself.
- ESLint config is in `eslint.config.js`; Tailwind has no standalone config.

## Package Manager

Scripts are defined in `package.json` and use `bunx` internally. Run them
with `bun run <script>`; use `bunx` for one-off CLI invocations.

## Dev / Build / Run

- `bun run dev` — dev server with HMR at `http://localhost:5173`.
- `bun run build` — production build in `build/`.
- `bun run start` — serve the built bundle (port 3000 by default).
- `bun run typecheck` — React Router typegen + TypeScript.
- `bun run format` / `format:check` — Prettier with and without writing.
- `bun run check` — format check, typecheck, tests, lint. What CI runs.
- `bun run health` — the same plus a reformat first. Use this locally.

A `Dockerfile` exists but is not how this is deployed, is not built in CI,
and is unverified. Production runs under systemd from a checkout; see
`deploy/emusync.service` and the deployment section of `README.md`.

## Linting & Tests

- Vitest via `bun run test`; a single file with `bunx vitest path/to/file`.
- Prefer Vitest + React Testing Library for new tests.
- CI (`.github/workflows/ci.yml`) runs `check`, then `build`, then
  `deploy/smoke.sh`. The smoke step exists because `check` passes happily on
  a tree that cannot boot — it starts the built server against a throwaway
  config and asserts `/api/devices` returns a usable device list.
- **Verify new tests by mutation.** Revert the fix the test covers, confirm
  that test — and ideally only that test — fails, then restore. A test that
  passes against the reintroduced bug is not protecting anything. This has
  caught several of this repo's own tests.
- Prove a check works by making it fail, not by trusting a zero exit. `bun -e`
  in particular exits 0 on an uncaught throw once the script touches
  `require()`, so a throwing validator always "passes".

## Local Setup

- Redis is required. Default `redis://localhost:6379`, override with
  `REDIS_URL`. `initializeServer` connects lazily, so the process starts
  without it and individual requests fail instead.
- `zip`/`unzip` must be on `PATH` (Dolphin Android sync).
- `rsync` is optional; without it ssh devices fall back to scp. Switch
  devices (`os: "nx"`) use FTP either way and never reach the probe.
- Document env vars in `.env.example` and never commit secrets. `db.json` is
  gitignored — it holds real device addresses and paths.

## Code Conventions

- Prettier owns formatting: 4-space indent, double quotes, trailing commas.
- Prefer the `~/` alias for anything under `app/`; use `import type` for
  type-only imports; import MUI from explicit modules
  (`@mui/material/Box`).
- TypeScript is strict. Avoid `any`; use `unknown` and narrow.
- Function components and hooks only. Route modules export some of `meta`,
  `loader`, `action`, and a default component, and import their types from
  `./+types/<route>`.
- Components are PascalCase, hooks are `useX`, contexts are `XContext` plus
  `XProvider`, routes are lowercase by segment, API routes are
  `routes/api.*.ts` with `$id` for dynamic params.
- MUI `sx` is the primary styling mechanism; Tailwind is available but used
  sparingly. Prefer the design tokens in `app/app.css`.
- Accessibility is linted, not vibes: `eslint-plugin-jsx-a11y` runs on every
  check and will fail the build.

## Server & API Conventions

- API routes live in `app/routes/api.*.ts`. Call `initializeServer` before
  touching device state, and return `Response.json` with explicit status
  codes.
- Keep Redis access behind the helpers in `app/server/redis.ts`; routes
  should not talk to the client directly.
- Keep route files thin — logic belongs in small helpers under
  `app/server/`.
- Only one sync runs at a time. A second request gets a 409 carrying the
  in-flight job id, because pulls stage through the single server `workDir`.

## Common Workflows

- Adding a route: create `app/routes/*.tsx`, then update `app/routes.ts`.
- Changing routes: run `bun run typecheck` to regenerate types.
- Adding server logic: put helpers in `app/server/`, keep routes thin.
- Adding shared data types: define them in `app/types/`.

## Git Hooks

Husky runs a `pre-commit` hook that formats **only the staged files** and
re-adds them. It deliberately does not run `bun run format` over the whole
repo — that swept unrelated working-tree changes into commits. The staged
list is passed through a temp file because command substitution strips the
NUL separators from `git diff -z`.
