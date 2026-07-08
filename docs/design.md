# RoomBot — Design Spec
**Hackathon:** Cursor Physical AI Hackathon Almaty 2026
**Track:** World Models + Embodied AI
**Date:** 2026-07-08
**Timeline:** 6 hours

---

## What It Is

Scan your real room with an iPhone. Upload the 3D scan to a web app. An AI labels every object in the room — table, sofa, door, walkable floor. A simulated robot then operates inside your actual room, receives natural language tasks, navigates the real space, and replans when blocked.

**One-line pitch:** "Test your robot in your real room — without owning a robot."

**Why it matters:** Companies building physical robots can't test in every environment. This lets them simulate robot behavior in any real-world room from a phone scan — before shipping hardware.

---

## Core Flow

```
iPhone LiDAR scan
       ↓
  Export .GLB file (Scaniverse app)
       ↓
  Upload to web app
       ↓
  Three.js renders the 3D room in browser
       ↓
  Vision model (Claude) labels objects + walkable areas
       ↓
  User speaks/types a task: "clean under the table"
       ↓
  Claude plans steps → robot executes in 3D room
       ↓
  Obstacle encountered → replans live
       ↓
  GPT-4o Realtime narrates robot's decisions out loud
```

---

## Features

### 1. iPhone LiDAR Scan → 3D Room in Browser
- Use **Scaniverse** app (free, iPhone 12 Pro+) to scan the room
- Export as `.GLB` (web-friendly 3D format)
- Upload to web app → Three.js renders the real room in browser
- User can rotate/zoom the scan to inspect it

### 2. AI Scene Understanding (Vision Model)
- Send a top-down screenshot of the 3D scan to Claude vision API
- Claude returns: object labels, positions, walkable floor areas, obstacle zones
- Overlay labels on the 3D scene — "sofa", "table 80cm from wall", "door", "clear path"
- This is the **world model** — the AI's understanding of the physical space

### 3. Natural Language Task + Robot Execution
- Single text/voice input: *"Navigate to the kitchen and avoid the table"*
- Claude plans steps based on the labeled room layout
- Simulated robot (3D capsule/sphere) animates through the real room
- Plan shown in side panel, each step highlighted as executed

### 4. Dynamic Replanning
- User can place a virtual obstacle mid-run (click to add)
- Robot detects blocked path → calls Claude to replan remaining steps
- Robot narrates: *"Obstacle at [position], finding alternate route"*
- Key demo moment: the robot adapts to a changing real-world-derived environment

### 5. Voice Commands + Robot Narration (GPT-4o Realtime API)
- User speaks commands instead of typing (microphone input)
- Robot narrates every decision out loud in real time
- *"I see the table 1.2 meters ahead. Adjusting path left. Heading to the door."*
- Makes the demo feel like talking to a real autonomous agent

---

## Tech Stack

| Layer | Tool | Why |
|-------|------|-----|
| 3D Scanning | Scaniverse (iPhone) | Free, LiDAR, exports .GLB |
| 3D Rendering | Three.js | Best browser 3D, handles .GLB natively |
| Scene Understanding | Claude API (vision) | Labels objects from scan screenshot |
| Task Planning | Claude API (`claude-sonnet-4-6`) | NL → structured robot steps |
| Voice I/O | GPT-4o Realtime API | Low-latency voice in + narration out |
| Frontend | Next.js + Tailwind | Already scaffolded |
| State | React useReducer | Robot state, plan steps, obstacle map |

---

## UI Layout

```
┌──────────────────────────────────┬─────────────────────┐
│                                  │  Scene Labels        │
│     3D Room (Three.js)           │  ─────────────────   │
│     (rotatable, zoomable)        │  🛋 sofa (2.1m N)   │
│                                  │  🪑 table (center)  │
│     [robot agent visible         │  🚪 door (south)    │
│      navigating real room]       │                      │
│                                  │  Robot Plan          │
│                                  │  ─────────────────   │
│                                  │  ✓ move north 1.5m  │
│                                  │  ▶ turn left 45°    │
│                                  │  · approach table   │
├──────────────────────────────────┴─────────────────────┤
│  🎤  Speak or type a task...                [Execute]   │
└─────────────────────────────────────────────────────────┘
```

---

## Claude Prompts

**Scene understanding (vision):**
```
You are analyzing a 3D room scan. Identify all objects, their approximate
positions relative to room center, and mark which floor areas are walkable.
Return JSON: { objects: [{name, position, size}], walkable_zones: [{x, z, radius}] }
```

**Task planning:**
```
You are a robot controller. The room layout is: [scene JSON].
The user task is: "[task]". Return a JSON array of navigation steps:
[{ action: "move"|"turn"|"interact", target: string, distance_m: number }]
Only use known walkable zones. Avoid all object positions.
```

**Replanning (obstacle hit):**
```
Robot was executing [plan]. At step [N], path blocked at [position].
New obstacle at [x, z]. Return revised steps for remaining task,
routing around the obstacle. Room layout: [scene JSON].
```

---

## Demo Script (for judges)

1. **(30s)** Show the iPhone scan loading into browser — real room, rotating 3D model
2. **(30s)** Point to AI labels — "the vision model has identified every object and mapped walkable areas — this is the world model"
3. **(1min)** Speak: *"Navigate to the table and then go to the door"* — robot moves through the real room
4. **(30s)** Drop an obstacle mid-route — robot replans, narrates out loud
5. **(30s)** Pitch: *"Any company building robots can scan a room in 2 minutes and test their agent before shipping hardware. We built the simulation layer."*

---

## Build Order (6-hour timeline)

| Hour | Task |
|------|------|
| 0:00–0:30 | Scan a room with Scaniverse, export .GLB |
| 0:30–1:30 | Three.js viewer — load .GLB, camera controls |
| 1:30–2:30 | Claude vision API — scene understanding + object labels overlay |
| 2:30–3:30 | Robot agent in 3D scene — basic navigation along waypoints |
| 3:30–4:30 | Claude task planning + replanning on obstacle |
| 4:30–5:30 | GPT-4o Realtime API — voice input + robot narration |
| 5:30–6:00 | Polish, test demo script, practice pitch |

---

## Why This Wins

- **Real room in browser** — not a fake grid, actual LiDAR scan of a physical space
- **Full Physical AI stack** — perception (LiDAR) → world model (vision AI) → planning (LLM) → execution (simulation)
- **Practical product** — solves a real problem: sim-to-real testing without hardware
- **Multi-modal demo** — 3D visuals + voice commands + real-time narration = jaw-dropping
- **Hits 2 tracks** — World Models + Embodied AI
