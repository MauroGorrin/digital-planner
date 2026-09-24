# Epic 02: Integration test, CI pipeline, and deploy readiness

> Después de este epic, las funciones `SECURITY DEFINER` de Postgres están probadas contra una
> Supabase local real, GitHub Actions corre lint + typecheck + pruebas + build en cada push/PR con
> Node 22, el workspace de agente está verificado, y `npm run build` + la documentación de
> despliegue en Vercel están listos para producción.

| | |
|---|---|
| **Epic id** | `02-integration-ci-deploy` |
| **Tasks** | `E2-T1` … `E2-T5` |
| **Depends on** | `01-toolchain-and-unit-tests` (specifically `E1-T3`) |
| **Unlocks** | nothing — this is the last epic |
| **Parallel with** | `E2-T1`, `E2-T2`, and `E2-T4` share no files and may run concurrently once `E1-T3` is done |

You do not need any other file to complete this epic. Everything below is repeated here on purpose.

---

## Stack

Next.js 14.2.35 (App Router, Server Actions) · TypeScript 5.5 (strict) · Supabase (Postgres + Auth
+ Storage + RLS, local via Supabase CLI + Docker for this epic) · Vitest 5 (`--environment node`
for integration) · GitHub Actions · Vercel. Package manager: `npm`.

| Task | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit tests | `npm run test` |
| Integration tests | `npm run test:integration` |
| Start local Supabase | `npx supabase start` |
| Reset local Supabase (reapply migrations) | `npx supabase db reset` |
| Stop local Supabase | `npm run db:test:stop` |
| Build | `npm run build` |

**Gate:** `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`
passes before any task here is marked done.

If a task below verifies against Supabase local, start it first with `npx supabase start`. The
config that defines it (`supabase/config.toml`) shipped in `workspace/` and is already at the
project root — you do not write it, and you never substitute an in-memory fake for it. The
`SECURITY DEFINER` functions under test are the real authorization logic; a mock would prove
nothing.

## Directory subtree

Only the parts this epic touches. `supabase/config.toml` and `.github/workflows/ci.yml` already
exist at these exact paths — copied by Bootstrap from the bundle's `workspace/`, before `E1-T1` of
the previous epic even started.

```
supabase/
  config.toml               # exists already (Bootstrap) — local dev/test config for the CLI
  migrations/
    0001_init.sql            # existing, read-only — schema, RLS, the 7 SECURITY DEFINER functions
    0002_storage.sql         # existing, read-only — attachments bucket + storage policies
scripts/
  write-supabase-test-env.mjs   # NEW — E2-T1
tests/
  integration/
    state-transitions.test.ts   # NEW — E2-T1
  unit/
    lib/
      google-calendar-sync.test.ts   # NEW — E2-T2
lib/
  google-calendar/sync.ts     # existing, read-only — the module E2-T2 tests
.github/
  workflows/
    ci.yml                    # exists already (Bootstrap) — E2-T3 verifies it, does not create it
README.md                    # edited by E2-T3 (CI section) and E2-T5 (deploy section)
package.json                 # edited by E2-T1 (scripts + supabase devDependency)
```

Everything outside this subtree is out of scope. If a task seems to require editing a file not
listed here, stop and report — it means the epic boundary is wrong.

## Data model touched here

None new. `E2-T1`'s integration test writes real rows through the existing schema (`clients`,
`profiles`, `client_contacts`, `content_pieces`, `status_history`, `approvals`) and deletes them in
`afterAll` — it never adds a table, column, or migration. See `blueprint.md` §4, "Delta" —
`NOT APPLICABLE`.

## Contracts

**Consumed** — already exists, do not rebuild:

| From | Interface | Guarantee |
|---|---|---|
| previous epic (`E1-T3`) | `npm run test` | exits 0, 0 failed/skipped |
| existing repo | `submit_for_review(p_content_piece_id uuid)` RPC | requires `is_agency()`; writes `status_history` + `notifications` |
| existing repo | `approve_content_piece(p_content_piece_id uuid, p_note text default null)` RPC | requires the caller to be a `client_contacts` row for that `client_id`; writes `status_history` + `approvals` + `notifications` |
| existing repo | `lib/google-calendar/sync.ts` exports `syncPieceToGoogleCalendar` | upserts via `calendar_event_links`, `PATCH` on an existing link instead of creating a duplicate |
| Bootstrap (`workspace/`) | `supabase/config.toml`, `.github/workflows/ci.yml` | local Postgres on port 54322, API on 54321; CI job named `test` running on `ubuntu-latest` |

**Produced** — nothing downstream depends on this epic; it is the last one.

## Conventions that bite in this area

- **Never mock Postgres in `tests/integration/**`.** The entire point of `E2-T1` is exercising the
  real `SECURITY DEFINER` functions — a mock proves nothing about the authorization logic they
  contain. See `.claude/rules/tests.md`.
- **Local Supabase credentials are never hardcoded.** `scripts/write-supabase-test-env.mjs` reads
  them from `npx supabase status -o json` at run time and writes `.env.test.local`, which is
  already excluded by the repo's existing `.gitignore` pattern `.env*.local`. If the JSON key names your installed CLI version prints differ
  from `API_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY`, run `npx supabase status -o json` once by hand
  and adjust the script's property names — never fall back to a hardcoded credential.
- **`npm run test:integration` runs `supabase start && supabase db reset && ...` every time.** This
  is deliberate — it proves the migrations apply cleanly from zero on every run, not just once. It
  is also why `afterAll` cleanup in `E2-T1`'s test matters: without it, a second run in the same
  session (without a reset in between) would collide with the previous run's rows.
- **`E2-T3` does not create `.github/workflows/ci.yml`.** It already exists from Bootstrap. This
  task's job is to prove, locally, that every command the workflow runs actually passes — so the
  first real push already has a green CI run instead of discovering a broken command in the
  GitHub UI.
- **`E2-T4` touches zero files.** It is a pure verification task confirming the agent workspace
  Bootstrap copied (`CLAUDE.md`, `AGENTS.md`, `.claude/`) landed correctly. An empty `files` array
  in `tasks.json` is correct here, not a mistake.
- **`supabase start` writes generated state into the repo, and `E2-T1` must gitignore it.**
  `supabase/.temp/` holds `start-secrets/**/docker.env` with the local instance's keys, and
  `supabase/.branches/` holds the current-branch marker. Neither is covered by any pre-existing
  pattern, and `E2-T1`'s own `git add -A` checkpoint commits both if you skip this. Found by
  running the task live — the commit landed before the pattern did, and had to be undone with
  `git rm -r --cached supabase/.temp`.

Full project rules: `CLAUDE.md`. Area rules: `.claude/rules/tests.md`. Both sit in the project
root — the builder copied them there from the bundle's `workspace/` before task one.

---

## Tasks

Listed in the same order as `tasks.json`. That order is the build order — work top to bottom and do
not re-rank by priority or by what looks quick.

### `E2-T1` — Local Supabase integration harness + state-transition test (data-layer gate)

**Depends on:** `E1-T3` · **Priority:** p0 — this is the data-layer gate the whole blueprint exists
to add

Install `supabase@2.117.0` as a devDependency. Add scripts:
`"test:integration": "npx supabase start && npx supabase db reset && node scripts/write-supabase-test-env.mjs && vitest run tests/integration --environment node"`
and `"db:test:stop": "npx supabase stop"`.

Write `scripts/write-supabase-test-env.mjs`: runs `npx supabase status -o json`, parses it, and
writes `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
and `NEXT_PUBLIC_APP_URL=http://localhost:3000` to the path given as its first CLI argument
(`process.argv[2]`), defaulting to `.env.test.local` when none is given. `E2-T5` reuses this same
script with `.env.local` as the argument — write it parametrized from the start, do not hardcode
the destination path.

Write `tests/integration/state-transitions.test.ts` using `@supabase/supabase-js` (already a
runtime dependency — no new package needed for the client itself):

1. A service-role client (`createClient(url, serviceRoleKey)`) creates two auth users via
   `auth.admin.createUser({ email, password, email_confirm: true })` — one for the agency admin,
   one for the client contact. `handle_new_user()` auto-creates their `profiles` rows; update the
   admin's `profiles.role` to `'agency_admin'`.
2. The service client inserts a `clients` row, a `client_contacts` row linking the client-contact
   user to it, and a `content_pieces` row (`status` defaults to `'borrador'`).
3. Sign in as the admin via an anon-key client (`auth.signInWithPassword`) and call
   `.rpc('submit_for_review', { p_content_piece_id })`.
4. Sign in as the client-contact user and call
   `.rpc('approve_content_piece', { p_content_piece_id, p_note: 'Se ve bien' })`.
5. As a negative case, sign in as a third test user who is a `client_contacts` member of a
   *different* client and call `approve_content_piece` on the same piece — expect an error.
6. In `afterAll`, delete the `clients` row (cascades to `content_pieces`, `client_contacts`,
   `status_history`, `approvals`) and delete all three auth users via
   `auth.admin.deleteUser`.

**Files**
- `package.json` — edit: `supabase` devDependency + 2 scripts
- `package-lock.json` — edit
- `scripts/write-supabase-test-env.mjs` — new
- `tests/integration/state-transitions.test.ts` — new
- `.gitignore` — edit: add `supabase/.temp/` and `supabase/.branches/`, both written by `supabase start`

**Acceptance**

Copied verbatim from `tasks.json`'s `E2-T1.acceptance`:

1. **WHEN** `npm run test:integration` runs against a freshly reset local Supabase
   **THE SYSTEM SHALL** apply both `supabase/migrations/0001_init.sql` and
   `supabase/migrations/0002_storage.sql` with zero errors via `supabase db reset`.
2. **WHEN** the test signs in as the seeded `agency_admin` test user and calls
   `.rpc('submit_for_review', { p_content_piece_id })` on a `borrador` piece **THE SYSTEM SHALL**
   leave exactly one new `status_history` row with `to_status = 'pendiente_revision'` and update
   `content_pieces.status` to `pendiente_revision`.
3. **WHEN** the test signs in as the seeded client-contact test user (linked via
   `client_contacts`) and calls `.rpc('approve_content_piece', { p_content_piece_id, p_note })` on
   that same piece **THE SYSTEM SHALL** leave exactly one new `status_history` row with
   `to_status = 'aprobado'`, insert exactly one `approvals` row with `decision = 'aprobado'`, and
   update `content_pieces.status` to `aprobado`.
4. **WHEN** a signed-in test user who is NOT a client contact of that client calls
   `.rpc('approve_content_piece', ...)` on the same piece **THE SYSTEM SHALL** return an error and
   leave `content_pieces.status` unchanged.
5. **WHEN** the test suite finishes **THE SYSTEM SHALL** delete every row and test user it created,
   in an `afterAll`, so `npm run test:integration` is safe to re-run against the same local
   instance.

**Verify**

```bash
npx supabase start
npx supabase db reset
node scripts/write-supabase-test-env.mjs
npx vitest run tests/integration --environment node
node -e "const p=require('./package.json'); if(p.devDependencies.supabase !== '2.117.0') process.exit(1)"
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T1: local Supabase integration harness + state-transition test"
git tag step-06-integration-state-transitions
```

### `E2-T2` — Unit tests for Google Calendar upsert-without-duplicate logic

**Depends on:** `E1-T3` · **Priority:** p0 — may run in parallel with `E2-T1` and `E2-T4`

Create `tests/unit/lib/google-calendar-sync.test.ts`. Mock `@/lib/supabase/server`'s
`createServiceClient` to return fixtures for `client_calendar_mappings`,
`google_calendar_connections`, and `calendar_event_links` per scenario. Mock `global.fetch` for
both the Google OAuth token endpoint and the Calendar API. Use a non-expired mock `access_token`
by default; override it to an expired one for the refresh-flow assertion.

**Files**
- `tests/unit/lib/google-calendar-sync.test.ts` — new

**Acceptance**

Copied verbatim from `tasks.json`'s `E2-T2.acceptance`:

1. **WHEN** `syncPieceToGoogleCalendar` is called for a piece whose client has no mocked row in
   `client_calendar_mappings` **THE SYSTEM SHALL** return `{ skipped: 'sin_calendario_configurado' }`
   and **SHALL NOT** call `fetch`.
2. **WHEN** a mocked mapping and a valid non-expired `access_token` exist and NO mocked row exists
   yet in `calendar_event_links` for that piece **THE SYSTEM SHALL** call `fetch` with method
   `POST` against the events-insert URL, then insert a new mocked `calendar_event_links` row with
   the returned `google_event_id`.
3. **WHEN** a mocked mapping exists AND a `calendar_event_links` row already exists for that piece
   (the reschedule case) **THE SYSTEM SHALL** call `fetch` with method `PATCH` against that
   existing `google_event_id`'s URL, and **SHALL NOT** insert a second `calendar_event_links` row.
4. **WHEN** the stored `access_token` is expired and a `refresh_token` exists **THE SYSTEM SHALL**
   first `POST` to the Google OAuth token endpoint to refresh it before calling the Calendar API.
5. **WHEN** the mocked Calendar API responds non-OK **THE SYSTEM SHALL** return
   `{ error: <response body text> }` and **SHALL NOT** write to `calendar_event_links`.

**Verify**

```bash
npx vitest run tests/unit/lib/google-calendar-sync.test.ts
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T2: unit tests for Google Calendar upsert-without-duplicate logic"
git tag step-07-google-calendar-sync-tests
```

### `E2-T3` — Verify the CI pipeline (`.github/workflows/ci.yml`) locally before the first push

**Depends on:** `E1-T2`, `E1-T4`, `E1-T5`, `E2-T1`, `E2-T2` · **Priority:** p1

`.github/workflows/ci.yml` already exists at the project root (Bootstrap). Add a `## CI` section to
`README.md` documenting the trigger (push + pull request) and the required check name (`CI / test`
in GitHub's branch-protection UI). Then run every command the workflow runs, locally, in the same
order, to prove it will pass before it is ever pushed.

**Files**
- `README.md` — edit: add `## CI` section

**Acceptance**

Copied verbatim from `tasks.json`'s `E2-T3.acceptance`:

1. **WHEN** `.github/workflows/ci.yml` is inspected **THE SYSTEM SHALL** declare triggers for both
   `push` and `pull_request`.
2. **WHEN** `.github/workflows/ci.yml` is inspected **THE SYSTEM SHALL** pin
   `actions/checkout@v7` and `actions/setup-node@v7` with `node-version: '22'`.
3. **WHEN** `.github/workflows/ci.yml` is inspected **THE SYSTEM SHALL** run, in order,
   `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run test:integration`, and
   `npm run build`.
4. **WHEN** every command from the previous criterion is run locally, in that order, on this
   machine **THE SYSTEM SHALL** exit 0 on each.

**Verify**

```bash
grep -q "pull_request" .github/workflows/ci.yml
grep -q "^  push:" .github/workflows/ci.yml
grep -q "actions/checkout@v7" .github/workflows/ci.yml
grep -q "actions/setup-node@v7" .github/workflows/ci.yml
grep -q "node-version: '22'" .github/workflows/ci.yml
grep -q "npm run lint" .github/workflows/ci.yml
grep -q "tsc --noEmit" .github/workflows/ci.yml
grep -q "npm run test" .github/workflows/ci.yml
grep -q "npm run test:integration" .github/workflows/ci.yml
grep -q "npm run build" .github/workflows/ci.yml
npm run lint
npx tsc --noEmit
npm run test
npm run test:integration
npm run build
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T3: verify CI pipeline locally, document CI in README"
git tag step-08-ci-pipeline
```

### `E2-T4` — Verify the agent workspace (`CLAUDE.md`, `AGENTS.md`, `.claude/`) landed correctly

**Depends on:** nothing · **Priority:** p2 — metadata only, not a build blocker; may run any time
after Bootstrap

No new files. Confirm the five workspace artifacts Bootstrap copied are present and correct:
`CLAUDE.md`, `AGENTS.md`, `.claude/settings.json` (valid JSON), and
`.claude/skills/approval-flow-webhooks/SKILL.md` documents every `content_status` and
`webhook_event_type` literal from `types/database.ts`, and `.claude/rules/tests.md` exists.

**Files**
- none — this task validates artifacts emitted under `workspace/` (`blueprint.md` §19), authored
  by no step

**Acceptance**

Copied verbatim from `tasks.json`'s `E2-T4.acceptance`:

1. **WHEN** `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`,
   `.claude/skills/approval-flow-webhooks/SKILL.md`, and `.claude/rules/tests.md` are checked
   **THE SYSTEM SHALL** find all five present at the project root.
2. **WHEN** `.claude/settings.json` is parsed **THE SYSTEM SHALL** parse as valid JSON.
3. **WHEN** `.claude/skills/approval-flow-webhooks/SKILL.md` is inspected **THE SYSTEM SHALL**
   mention all 7 `content_status` values (`borrador`, `pendiente_revision`,
   `cambios_solicitados`, `aprobado`, `programado`, `publicado`, `cancelado`) and all 7
   `webhook_event_type` values (`pieza_creada_revision`, `pieza_aprobada`, `cambios_solicitados`,
   `comentario_agregado`, `fecha_cambiada`, `pieza_programada`, `pieza_publicada`).

**Verify**

```bash
test -f CLAUDE.md
test -f AGENTS.md
test -f .claude/settings.json
test -f .claude/skills/approval-flow-webhooks/SKILL.md
test -f .claude/rules/tests.md
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"
for v in borrador pendiente_revision cambios_solicitados aprobado programado publicado cancelado pieza_creada_revision pieza_aprobada comentario_agregado fecha_cambiada pieza_programada pieza_publicada; do grep -q "$v" .claude/skills/approval-flow-webhooks/SKILL.md || exit 1; done
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T4: verify agent workspace" --allow-empty
git tag step-09-agent-workspace
```

### `E2-T5` — Production build verification + Vercel deploy readiness (Node 22.x)

**Depends on:** `E2-T3` · **Priority:** p0

**Smoke-test finding, fixed here:** `middleware.ts` builds a Supabase client on every request,
including `/login` — without real credentials the built server answers 500, not 200. Reuse the
local Supabase from `E2-T1` instead of requiring production credentials for this check:

1. `npx supabase start` (safe no-op if already running).
2. `node scripts/write-supabase-test-env.mjs .env.local` — same script as `E2-T1`, different
   destination. Next.js loads `.env.local` natively in `build`/`start`.
3. `npm run build`, confirm exit 0.
4. Start the built server with `npm start`, request `/login` (the one route that needs no
   session), confirm it responds 200 — against local Supabase, never a made-up production URL.
5. `npx supabase stop`.
6. Add a "## Despliegue en Vercel" section to `README.md` listing every variable name from
   `.env.example` (7 variables, production — `.env.local` here is only for this local smoke
   check) and stating that the Vercel project's Node.js Version setting must be `22.x`.

**Files**
- `README.md` — edit: add `## Despliegue en Vercel` section

**Acceptance**

Copied verbatim from `tasks.json`'s `E2-T5.acceptance`:

1. **WHEN** `npm run build` runs **THE SYSTEM SHALL** exit 0 and produce `.next/BUILD_ID`.
2. **WHEN** the built server is started with `npm start` and queried at `/login`
   **THE SYSTEM SHALL** respond with HTTP 200.
3. **WHEN** README.md's "Despliegue en Vercel" section is inspected **THE SYSTEM SHALL** list all
   7 variable names from `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`).
4. **WHEN** README.md's "Despliegue en Vercel" section is inspected **THE SYSTEM SHALL** state
   that the Vercel project's Node.js Version setting must be `22.x`.
5. **WHEN** `package.json`'s `engines.node` is inspected **THE SYSTEM SHALL** still read `22.x`,
   unchanged since step 1.

**Verify**

```bash
npx supabase start
node scripts/write-supabase-test-env.mjs .env.local
npm run build
test -f .next/BUILD_ID
npm start & SERVER_PID=$!; sleep 3; CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login); kill $SERVER_PID; test "$CODE" = 200
npx supabase stop
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_APP_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI; do grep -q "$v" README.md || exit 1; done
grep -q "22.x" README.md
node -e "const p=require('./package.json'); if(p.engines.node !== '22.x') process.exit(1)"
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T5: production build verification + Vercel deploy readiness"
git tag step-10-production-build-vercel-readiness
```

---

## Epic acceptance

The epic is done when every task is `done` **and**:

1. **WHEN** `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`
   runs from the project root **THE SYSTEM SHALL** exit 0 on every command.
2. **WHEN** `git tag -l 'step-*'` is listed **THE SYSTEM SHALL** show all 10 checkpoint tags,
   `step-01-node22-target` through `step-10-production-build-vercel-readiness`.

```bash
npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build
git tag -l 'step-*'
```

Run from the project root. Both criteria must be decidable by these commands.

## Pitfalls

- **Running `npm run test:integration` without Docker running fails at `supabase start`, not at a
  test assertion.** Read the error before assuming a code defect — it usually means the local
  Docker daemon is not running.
- **`supabase db reset` re-applies every migration from zero every time.** If a manual, unmigrated
  schema change was made to the local instance outside `supabase/migrations/`, it is silently
  discarded on the next reset — this is intentional, not a bug.
- **`E2-T5`'s `npm start &` leaves a background process.** The `Verify` block kills it via
  `$SERVER_PID` — if a task is aborted mid-run outside that block, check for and kill a stray
  `next start` process on port 3000 before retrying.
- **`E2-T5` also needs Docker running**, same as `E2-T1` — `middleware.ts` calls Supabase on every
  request including `/login`, so the built server needs real (local) credentials in `.env.local`
  to answer 200 instead of 500. This was found by running the smoke test live against this repo,
  not assumed.

## Before moving on

- [ ] Every task in this epic is `done` in `tasks.json` — no task left `in_progress`.
- [ ] Every `verify` command of every task in this epic passed, not just the first one.
- [ ] No `verify` command was edited, and none was skipped because a file it names did not exist.
- [ ] Every task in this epic has its `checkpoint` tag in version control — `git tag -l 'step-*'`
      lists 10 tags total, across both epics.
- [ ] Gate command passes clean, run from the project root.
- [ ] Every "Produced" contract above exists with the stated signature.
- [ ] No file outside the subtree was modified.
- [ ] `.env.example` unchanged — this epic reads env vars for local Supabase but adds no new
      product-facing variable (the local Supabase URL/keys live only in the gitignored
      `.env.test.local`).
- [ ] One commit per task, each prefixed with its task id, each followed by its checkpoint tag.
