# Homie — shared contracts for parallel agents

Read this + `docs/next16-notes.md` before writing code. These are the seams
between the 4 build agents. Wave 0 built the shared foundation below.

## File ownership map (stay in your lane)
| Agent | Owns |
| --- | --- |
| **viewer** | `src/components/RoomViewer.tsx` (Three.js GLB render, top-down render capture) |
| **sync** | `src/lib/store.ts`, `src/app/api/scan/**`, `src/app/m/**` (phone upload + state sync) |
| **ai-routes** | `src/app/api/{label,plan,realtime-session}/**`, `src/lib/openai.ts` (fill the stub) |
| **sim** | `src/sim/**` (A* pathfinding, robot execution, collision, replanning loop) |
| **studio-ui** | `src/app/s/**` and remaining `src/components/**` (landing, studio, controls, narration UI) |
| **Wave 0 (shared, done)** | `src/lib/types.ts`, `src/lib/schemas.ts`, `src/lib/prompts.ts`, `src/lib/openai.ts` (flag only), `public/sample-room.glb`, `scripts/generate-sample-room.mjs`, docs |

Import shared types/schemas/prompts; do not redefine them. Extend `types.ts`
(add fields) only if needed — never rename existing ones (breaks other agents).

## Coordinate conventions
- **World** = meters, XZ ground plane, Y up. `Vec2 = { x, z }` is a point on that plane.
- **Vision** = normalized image coords `[0,1]`, x right / z down (image y), from a
  TOP-DOWN orthographic render. Convert to world with `imageToWorld(p, bounds)` in `types.ts`.
- The vision model returns positions/sizes normalized; the ai-routes agent (or server)
  maps them to world via `imageToWorld` before storing a `SceneModel`. `SceneModel`
  and `Plan` waypoints are always WORLD meters.

## Geometry is truth, LLM is semantics
- Collision, walkability, and "is the robot blocked?" come ONLY from mesh raycasts /
  geometry in `src/sim/**` and the viewer — NEVER from the LLM.
- The LLM only (a) names objects + suggests walkable zones (label) and (b) suggests
  routes/notes (plan/replan). Treat its output as a hint validated against geometry.

## Errors as values
- Cross-seam functions and every API route return `ApiResult<T>`
  (`{ ok: true, data } | { ok: false, error }`). Do NOT throw across a boundary
  (route handler, store action, sim entry point). Catch internally, return `{ ok:false }`.
- API route bodies are validated with the zod schemas in `schemas.ts` before use.

## API contracts (payloads in `types.ts`)
- `POST /api/label`  body `LabelRequest`  → `ApiResult<SceneModel>`
- `POST /api/plan`   body `PlanRequest` (mode `'plan' | 'replan'`) → `ApiResult<Plan>`
- `GET/POST /api/realtime-session` → ephemeral token for GPT-4o Realtime voice.
- `src/app/api/scan/**` → phone-side GLB upload + retrieval (sync agent's shape).

## Mock mode
- `import { isMock } from '@/lib/openai'`.
- `export const isMock = !process.env.OPENAI_API_KEY || process.env.MOCK_AI === '1'`.
- When `isMock`, AI routes MUST return deterministic mocked `SceneModel`/`Plan` (no
  network, no spend) so the whole demo runs with zero keys. Build the mocks to match
  `public/sample-room.glb` so viewer + sim have something coherent to render.

## Next.js 16 reminders (see next16-notes.md)
- `params`/`searchParams`/`cookies()`/`headers()` are async — `await` them.
- Route handlers: read bodies with `await req.json()` / `req.arrayBuffer()`; no size limit;
  not cached. GLB uploads go through a route handler, not a Server Action.
- Three.js viewer must be a `'use client'` dynamic import with `ssr:false`, wrapped by a
  client component (ssr:false is illegal in Server Components).
- SSE/streaming: return `new Response(ReadableStream, { headers })`; validate before the
  first chunk (status locks once streaming starts).
- `public/sample-room.glb` is served at `/sample-room.glb`.

## AI routes (owned by ai-routes; `src/lib/openai.ts` + `src/app/api/{label,plan,realtime-session}`)

All three routes return `ApiResult<T>` (`Response.json`, never throw). Bad request
bodies (invalid JSON or zod-invalid) return HTTP **400** with `{ ok:false, error }`;
everything else — including real-mode OpenAI failures — returns HTTP **200** with
`{ ok:false, error }` so callers branch on `.ok`, not the status code.

**Mock mode** (`isMock` = no `OPENAI_API_KEY` or `MOCK_AI=1`): `label` and `plan`
return deterministic data from `src/lib/mock-data.ts` (matched to `sample-room.glb`)
after a ~700ms artificial delay so the UI shows its loading states; `realtime-session`
returns `{ ok:false, error:'mock-mode' }` (the client then falls back to
`speechSynthesis` — expected, not a bug).

### POST `/api/label` → `ApiResult<SceneModel>`
- Body: `LabelRequest` = `{ imageDataUrl: string (data: URL), bounds: Bounds }`.
- Real mode: GPT-4o vision (`labelPrompt`) returns objects/zones in NORMALIZED `[0,1]`
  image coords; the route converts them to WORLD meters via `imageToWorld(bounds)`
  (footprint `w`→`*width`, `d`→`*height`; zone `radius`→`*avg(width,height)`), drops
  off-image objects, dedupes same-name objects within 0.3 m, and injects `bounds`.
- Mock: `mockSceneModel(bounds)` — table `{0,0}`, sofa `{0,-1.45}`, doorway `{0,+2}`,
  4 walkable zones. `bounds` is always echoed from the request.

### POST `/api/plan` → `ApiResult<Plan>`  (`mode: 'plan' | 'replan'`)
- Body: `PlanRequest` = `{ scene: SceneModel, task, mode, context? }`. `replan`
  requires `context` (`{ completedSteps, blockedAt, remainingTask }`) → else 400.
- Real mode: `planPrompt`/`replanPrompt` → structured Plan. A `move` step with no
  `waypoint` fails validation and is retried once; every returned waypoint is clamped
  into `scene.bounds` (geometry is truth).
- Mock: `mockPlan(task)` (5 steps: cross to table, interact, exit via door) or
  `mockReplan(context, task)` (detours ~1.2 m to the roomier side of `blockedAt`,
  first note acknowledges the obstacle).

### GET|POST `/api/realtime-session` → `ApiResult<{ clientSecret, model, expiresAt? }>`
- Mints a short-lived ephemeral client secret for browser WebRTC voice; the real API
  key never reaches the client. Body ignored (config is server-side).
- Real mode: primary = SDK `openai.realtime.clientSecrets.create({ expires_after,
  session })` (openai@6 GA surface); fallback = raw fetch to
  `POST /v1/realtime/client_secrets`, then legacy `POST /v1/realtime/sessions` on 404.
  Session config: model `gpt-realtime` (override `OPENAI_REALTIME_MODEL`), voice
  `verse` (override `OPENAI_REALTIME_VOICE`), server-VAD turn detection, input
  transcription, `output_modalities:['audio']` (audio + transcript), and Homie
  narrator instructions (speak narration lines verbatim; treat user speech as task
  commands). `clientSecret` is the `ek_…` value the browser passes to the Realtime API.
