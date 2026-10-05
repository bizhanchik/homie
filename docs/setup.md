# Setup and troubleshooting

Scan your real room with an iPhone, then watch a virtual home robot navigate and
run tasks **inside your actual space** — labelled by a vision model, driven by an
LLM planner, and narrated out loud. It replans live when you drop an obstacle,
and ends on a one-click "Order Homie". Runs entirely in the browser; **works with
zero API keys** in mock mode.

**One-line pitch:** *We built the simulation layer for home robots.*

**Built for:** Cursor Physical AI Hackathon — Almaty 2026 · Tracks: World Models + Embodied AI

---

## Architecture

```
 iPhone (Scaniverse LiDAR)                      Desktop browser (the studio)
        │  scan → GLB                                   │
        │  open QR link /m/<id>, upload                 │  Three.js RoomViewer
        ▼                                               ▼  renders your real room
 ┌──────────────┐   SSE scan-ready   ┌─────────────────────────────────────────┐
 │ /api/scan/** │ ─────────────────▶ │  RoomViewer  ·  sim (A* + robot)         │
 │  (phone sync)│                    │  ─ geometry is truth ─                    │
 └──────────────┘                    │  grid walkability from mesh raycasts      │
                                     └───────────────┬───────────────────────────┘
   world model + planning (LLM is semantics)         │  top-down PNG
        ┌─────────────┬──────────────┬───────────────┴───────────┐
        ▼             ▼              ▼                            ▼
   /api/label    /api/plan     /api/realtime-session        (all return ApiResult<T>)
   vision →      NL task →     ephemeral WebRTC token
   SceneModel    Plan steps    for GPT Realtime voice
```

Four route handlers: **`/api/scan/**`** (phone upload + SSE sync), **`/api/label`**
(vision → object labels + walkable zones), **`/api/plan`** (task → plan / replan),
**`/api/realtime-session`** (mints an ephemeral voice token — the real key never
reaches the browser).

**Geometry is truth, LLM is semantics.** Collision, walkability, and "is the robot
blocked?" come only from mesh raycasts against a grid (`src/sim/**`). The LLM only
(a) names objects + suggests walkable zones and (b) suggests routes/notes — every
output is validated against geometry before it moves the robot.

**Mock mode** returns deterministic `SceneModel` / `Plan` data matched to
`public/sample-room.glb`, so the entire demo runs with **no keys and no spend**.

---

## Quickstart

```bash
npm install
npm run dev            # Next.js 16 (Turbopack). Open the printed URL.
```

Open **`/`** → **Open Studio**. With no keys set you're in **mock mode**: labelling
and planning return canned data (after a short delay so the loading states show),
and voice falls back to the browser's `speechSynthesis`. Everything demos end-to-end.

> **Port note:** `next dev` defaults to **:3000**. In this environment a dev server
> is already running on **:3111** — reuse it (HMR is live), don't start a second one.
> Substitute your actual port anywhere this README says `:3000`.

### Real AI (optional)

Create **`.env.local`** in the project root:

```bash
OPENAI_API_KEY=sk-...
# optional overrides (sensible defaults if omitted):
OPENAI_REALTIME_MODEL=gpt-realtime      # Realtime voice model
OPENAI_REALTIME_VOICE=verse             # Realtime voice
```

Then **restart `npm run dev`** (env is read at server start). Presence of
`OPENAI_API_KEY` flips label/plan to the real vision + planning models and enables
GPT Realtime voice. Force mock even with a key present via `MOCK_AI=1`.

---

## Phone sync (scan a real room)

The studio shows a **QR code** that points at **`/m/<session-id>`** on the phone.
The QR content comes from `NEXT_PUBLIC_BASE_URL` (falling back to the desktop's
`window.location.origin`) — so the phone needs a URL it can actually reach. Pick one:

### Option A — same Wi-Fi (LAN)

Phone and laptop on the same network. Bind the dev server to all interfaces and
tell the app your LAN origin, then restart:

```bash
# .env.local
NEXT_PUBLIC_BASE_URL=http://<your-lan-ip>:3000     # e.g. http://10.3.2.89:3000

next dev -H 0.0.0.0                                  # bind to LAN, not just localhost
```

Find your LAN IP with `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux).

### Option B — tunnel (any network, HTTPS)

Works across networks and gives HTTPS (required by iOS for camera/mic on some flows):

```bash
cloudflared tunnel --url http://localhost:3000
# copy the printed https URL, then:
# .env.local
NEXT_PUBLIC_BASE_URL=https://<printed-subdomain>.trycloudflare.com
```

Restart `npm run dev` after setting `NEXT_PUBLIC_BASE_URL` either way.

### Scaniverse capture steps (iPhone 12 Pro+)

1. **Scan** the room in Scaniverse.
2. **Share / Export** → choose **Mesh** → format **GLB**.
3. On the phone, open the studio's **QR link** (`/m/<id>`).
4. **Upload** the GLB — it beams up over SSE and renders in the desktop studio.

(No phone? The studio also loads `public/sample-room.glb` so you can demo without a scan.)

---

## Demo script (~3 min)

1. **Scan reveal (0:30)** — the LiDAR mesh loads and rotates in the browser. "This
   is a real room, scanned from a phone in seconds."
2. **Labels / world model (0:30)** — point at the floating labels. "The vision model
   named every object and mapped the walkable floor. This is the world model."
3. **Voice task (1:00)** — speak or type *"Go to the table, then head to the door."*
   Homie plans and walks the route, narrating each decision out loud.
4. **Obstacle replan (0:30)** — click to drop a red obstacle in its path. The robot
   detects the block from geometry, replans the remainder, and narrates the detour.
5. **Order + pitch (0:30)** — hit **Order Homie**. "Any robotics company can scan a
   room and test their agent before shipping hardware. **We built the simulation
   layer for home robots.**"

Full spec: [`docs/design.md`](docs/design.md).

---

## Custom robot model (optional)

The robot renders as an emerald **capsule** by default. Drop a rigged GLB at
**`public/robot.glb`** (skeleton + a walk and/or idle clip — e.g. an FBX exported
to GLB) and **reload the room** — the viewer picks it up with no rebuild:

- Auto-normalized: scaled to ~0.9 m tall, recentered so its feet sit on the floor,
  and yaw-rotated so it faces the direction of travel.
- Animation: clips are matched by name (`/walk|run/i` → walk, `/idle|stand/i` → idle;
  a single clip is treated as walk). Walk↔idle crossfades based on movement speed.
- If the file is absent or unparseable, the capsule stays silently (one `console.info`).
- Tuning knobs live at the top of `src/components/RoomViewer.tsx`
  (`ROBOT_TARGET_HEIGHT`, `ROBOT_YAW_OFFSET`, …). If the model faces the wrong way,
  nudge `ROBOT_YAW_OFFSET` by ±`Math.PI/2` (quarter turn) or `Math.PI` (half turn).

Verify quickly at **`/dev/viewer`** — the sidebar shows `robot model: capsule | glb`.

---

## Troubleshooting

| Symptom | Cause / Fix |
| --- | --- |
| Labels/plan are always the same canned room | **Mock mode** (no `OPENAI_API_KEY`). Expected. Add the key to `.env.local` and **restart** for real AI. |
| Voice uses a robotic browser voice | Mock mode returns no Realtime token, so the client falls back to `speechSynthesis`. Add a key + restart for GPT Realtime. This is not a bug. |
| Realtime session errors / 404 on the voice model | Your account may not have `gpt-realtime`. Set `OPENAI_REALTIME_MODEL` to a model you can access (and `OPENAI_REALTIME_VOICE` if needed), then restart. |
| QR scans but phone can't load the page | The QR points at `localhost`. Set `NEXT_PUBLIC_BASE_URL` to a LAN or tunnel URL and restart (see **Phone sync**). |
| Robot is a capsule, not my model | `public/robot.glb` missing/unparseable, or you didn't reload the room after adding it. Check `/dev/viewer` for `robot model:`. |
| Robot model faces the wrong way / wrong size | Adjust `ROBOT_YAW_OFFSET` / `ROBOT_TARGET_HEIGHT` at the top of `RoomViewer.tsx`. |
| "Port already in use" | A dev server is already running (here on **:3111**). Reuse it — don't start a second `next dev` (a lockfile blocks two). |
| Changed `.env.local`, nothing happened | Env is read at server start. **Restart** `npm run dev`. |

---

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Three.js · Tailwind CSS v4 ·
OpenAI (vision labelling, planning, Realtime voice) · zod · TypeScript.
