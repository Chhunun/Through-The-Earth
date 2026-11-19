# Abyss — CLAUDE.md

Hackathon project for **Patriot HackFest Fall 2026**, track "Life underground". The event brief is in `../Patriot HackFest Fall 2026 Event Information.pdf` (one folder above this repo).

## The scenario (for product decisions)
It's 2087. Two billion people live in **the Hollow**, a stack of underground levels. Deeper levels are hotter and darker, and they get blackouts first. **The Directorate** (the government) controls air, the network and movement between levels, and its public numbers don't match reality. The track lists 15 problems: blackouts, fair rationing, heat, bad water, flooding, crowding, communication without the Directorate's network, families split up during blackouts, lung-sickness outbreaks, medicine, sunlight deprivation, food, surface safety, and surface outposts and migration. Judges favor **one well-connected solution that covers several problems**.

Abyss is a community comms and early-warning app. Today it touches problems **1** (blackout/air warnings), **3** (heat), **7** (organizing without the Directorate), **8** (family check-ins/SOS) and **9** (outbreak tracking via symptom reports). **The pitch focus is not decided yet.** Don't assume a direction; ask when a choice matters.

## Repo layout
All code is in `PatriotHacks_Chat_Starter_SDK58/patriothacks-chat/`, an npm-workspaces monorepo built on a PatriotHacks starter kit:

| Path | What it is |
| --- | --- |
| `shared/index.ts` | Package `@patriot/protocol`. The **single source of truth** for socket event names, types, validators (`isEnvelope`, `parseChatProfile`, `parseLevelReport`), report questions, room/level names, and incident thresholds. Imported by all three clients and servers. |
| `relay/index.ts` | Express + Socket.IO server (port 3000, `PORT` env). Challenge-based auth, encrypted DM queue, level rooms, presence, report/incident/temperature broadcasts. |
| `relay/reports.ts` | In-memory level reports, plus aggregation: summaries, incidents (≥2 power/air reports in 60 min), severe reports (the *last* choice of each question = most severe), average temperatures. |
| `relay/profiles.ts` | Display name + home level per public key, saved to `relay/profiles.local.json` (gitignored; override with `PATRIOT_PROFILES_FILE`). |
| `mobile/` | Expo SDK 58 app (expo-router, NativeWind/Tailwind, Zustand). `app/index.tsx` is the main screen; `src/chat.ts` is the Zustand store; `src/transport.ts` wraps the socket; `src/crypto.ts` handles NaCl keys in SecureStore; `src/storage.ts` stores envelopes in SQLite. |
| `browser-chat.cjs` | A self-contained web client. esbuild bundles inline browser code that imports `./shared/index.ts`, served at http://localhost:4173. It talks to the relay at `127.0.0.1:${PATRIOT_RELAY_PORT:-3000}`. |

The root `.idea/` folders are JetBrains IDE files; ask programmer whether or not to ignore them.

## Commands (run from `patriothacks-chat/`)
- `npm ci --include=dev`: install (Node 22.13+ or 24.3+).
- `npm run relay`: start the relay on :3000.
- `npm run start -w mobile -- --lan`: start Expo. Needs `mobile/.env` with `EXPO_PUBLIC_RELAY_URL=http://<laptop-LAN-IP>:3000` (copy `mobile/.env.example`).
- `node browser-chat.cjs`: start the web client on :4173 (the relay must be running).
- `npm run check`: type-checks mobile and relay. **This is the only automated validation; there are no tests.** Run it after every change.
- Android bundle sanity check: `npx expo export --platform android` from `mobile/`.

## Rules for working in this repo
1. **Keep mobile and the browser client in sync.** Every user-facing feature or change goes into `mobile/` **and** `browser-chat.cjs`. Both are used in the demo.
2. **Protocol changes start in `shared/index.ts`.** Add the event name, types and validator there first, then the relay handler, then both clients. Never hard-code event strings in a client or the relay.
3. **Level names are hard-coded outside `shared`.** `rooms` in `shared/index.ts` defines the levels (`Upper Level`, `Middle Level`, `Lower Levels`), but `relay/index.ts` (`publishPresence`) and `relay/reports.ts` (`levelTemperatures`, `incidentSnapshot`, `severeReports`) build `Record<Room, …>` literals by hand. If you add or rename a level, update those too, or better, derive them from `rooms`.
4. **Report question order matters.** For each question in `reportQuestions`, the last choice counts as "severe" for warnings. Keep the choices ordered from least to most severe.
5. **Relay state is in memory.** DMs, room history (last 100 per room), and reports are lost when the relay restarts. Only profiles persist. That's acceptable for the demo; don't add a database unless asked.
6. **Validate untrusted input on the relay** using the shared validators, and keep the auth-challenge flow and `authenticated` checks in every handler. Everything else can favor speed.
7. Mobile styling uses NativeWind `className`s. `app/index.tsx` has `POLISH 1/2/3` guide comments for visual edits; leave connection and send logic alone when making visual changes.

## Priorities
- **Demo-ready speed over robustness.** Visible, working features matter most. Shortcuts like in-memory state are fine.
- **The demo must keep working** on two surfaces: phones running Expo Go against a laptop relay over LAN, and the browser client on localhost:4173. Don't break either.
- The user is *somewhat familiar* with TypeScript, React Native/Expo and Socket.IO. Give brief explanations of non-obvious changes and use normal comments; no tutorials.

## Git workflow
- **Use feature branches and PRs**; don't commit straight to `main`. Commit or push only when asked.
- Teammates have pushed directly to `main` with `patch to …` messages. Don't rewrite their history.
- Before starting work, pull `main`, because teammates push often.

## Known gaps / ideas (not commitments)
- The project README describes the features; keep it current when features change.
- Phone-to-phone mesh (offline when the Directorate cuts the network) was the starter's planned "next milestone". `mobile/src/transport.ts` is the swap point.
- No forward secrecy, no persistent relay queue, no QR key verification, no push notifications.
