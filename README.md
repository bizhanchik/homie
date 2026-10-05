# Homie

Scan your room with an iPhone, then watch a virtual home robot plan and run tasks inside it.

The simulation layer for home robots. Built at the Cursor Physical AI Hackathon, Almaty 2026.

**Live:** [homie-coral.vercel.app](https://homie-coral.vercel.app)

## How it works

1. Scan a room with an iPhone (LiDAR) and upload it with a QR code.
2. A vision model names the objects and maps the floor.
3. Ask for a task by voice, like "go to the table, then the door".
4. The robot plans a route and narrates it. Drop an obstacle and it replans.

The room's geometry decides where the robot can go. The AI only names things and suggests routes.

## Run

```bash
npm install
npm run dev
```

It works with no API keys, using sample data. To use real AI, add `OPENAI_API_KEY` to `.env.local` and restart.

Phone setup, the demo script and troubleshooting are in [docs/setup.md](docs/setup.md).

## Stack

Next.js, React, Three.js, Tailwind, OpenAI vision, planning and Realtime voice.
