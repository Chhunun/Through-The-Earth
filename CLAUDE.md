# Abyss — CLAUDE.md

Hackathon project for **Patriot HackFest Fall 2026**, track "Life underground". The event brief is in `../Patriot HackFest Fall 2026 Event Information.pdf` (one folder above this repo).

## The scenario (for product decisions)
It's 2087. Two billion people live in **the Hollow**, a stack of underground levels. Deeper levels are hotter and darker, and they get blackouts first. **The Directorate** (the government) controls air, the network and movement between levels, and its public numbers don't match reality. The track lists 15 problems: blackouts, fair rationing, heat, bad water, flooding, crowding, communication without the Directorate's network, families split up during blackouts, lung-sickness outbreaks, medicine, sunlight deprivation, food, surface safety, and surface outposts and migration. Judges favor **one well-connected solution that covers several problems**.

Abyss is the repo/project name. The app's user-facing name is **Through The Earth** (UI headings, `mobile/app.json` `name`, relay startup log). It is a community comms and early-warning app. Today it touches problems **1** (blackout/air warnings), **3** (heat), **7** (organizing without the Directorate), **8** (family check-ins/SOS) and **9** (outbreak tracking via symptom reports). A private **Daily log** (sleep, mood, body health, meals) relates to **11** (sunlight deprivation) and **12** (food), but it shares nothing with the relay yet. **The pitch focus is not decided yet.** Don't assume a direction; ask when a choice matters.

## Repo layout
All code is in `PatriotHacks_Chat_Starter_SDK58/patriothacks-chat/`, an npm-workspaces monorepo built on a PatriotHacks starter kit. Internal identifiers still say "patriot" (`@patriot/protocol`, `PATRIOT_*` env vars, folder names, the Expo `slug`/`scheme`, storage keys). Leave them; only user-facing text uses the app name.

| Path | What it is |
| --- | --- |
| `shared/index.ts` | Package `@patriot/protocol`. The **single source of truth** for socket event names, types, validators (`isEnvelope`, `parseChatProfile`, `parseLevelReport`, `parseDailyLogEntry`), report and daily-log questions, chart colors, room/level names, and incident thresholds. Imported by both clients and the relay. |
| `relay/index.ts` | Express + Socket.IO server (port 3000, `PORT` env). Challenge-based auth, encrypted DM queue, level rooms, presence, report/incident/temperature broadcasts. |
| `relay/reports.ts` | In-memory level reports, plus aggregation: summaries, incidents (≥2 power/air reports in 60 min), severe reports (the *last* choice of each question = most severe), average temperatures. |
| `relay/profiles.ts` | Display name + home level per public key, saved to `relay/profiles.local.json` (gitignored; override with `PATRIOT_PROFILES_FILE`). |
| `mobile/` | Expo SDK 58 app (expo-router, NativeWind/Tailwind, Zustand). `app/index.tsx` is the main screen (sign-in, account switching, Chat/Status/Daily log tabs); `src/chat.ts` is the Zustand store plus the per-account profile cache; `src/transport.ts` wraps the socket; `src/crypto.ts` holds the NaCl keys of every account in SecureStore; `src/storage.ts` is SQLite (messages, contacts, check-in outbox, daily log). `src/DailyLog.tsx` is the Daily log tab; `src/terminal-colors.json` is the theme palette. |
| `browser-chat.cjs` | A self-contained web client. esbuild bundles inline browser code (inside a `String.raw` template, so no backticks or `${` in it) that imports `./shared/index.ts`, served at http://localhost:4173. It talks to the relay at `127.0.0.1:${PATRIOT_RELAY_PORT:-3000}`. Per-account data is in `localStorage`. |

The root `.idea/` folders are JetBrains IDE files; ask programmer whether or not to ignore them.

## Accounts and local storage
- There are no passwords. An account is a NaCl key pair stored on the device, and a device can hold several. The sign-in screen lists them and can add, switch or remove accounts; **Sign out** only returns to that screen.
- Active key: `patriothacks.box.v1` (mobile SecureStore) / `patriothacks.identity.v1` (browser `localStorage`). All saved accounts: `patriothacks.accounts.v1` on both.
- **Never rename persisted keys** (`patriothacks.*`, `patriot-chat.*`, `patriot-chat.db`). Renaming them silently wipes every user's identity, contacts and history.
- Everything stored locally is keyed by the account's public key. New per-account data must be too, and must be deleted when an account is removed: `forgetOwner` in `mobile/src/storage.ts` and `removeAccount` in `browser-chat.cjs`.
- Switching accounts: mobile closes the relay session and remounts `ChatScreen` (the `generation` key in `ChatRoute`); the browser saves the new active key and reloads the page.

## Commands (run from `patriothacks-chat/`)
- `npm ci --include=dev`: install (Node 22.13+ or 24.3+).
- `npm run relay`: start the relay on :3000.
- `npm run start -w mobile -- --lan`: start Expo. Needs `mobile/.env` with `EXPO_PUBLIC_RELAY_URL=http://<laptop-LAN-IP>:3000` (copy `mobile/.env.example`).
- `node browser-chat.cjs`: start the web client on :4173 (the relay must be running).
- `npm run check`: type-checks mobile and relay. **This is the only automated validation; there are no tests.** Run it after every change.
- Android bundle sanity check: `npx expo export --platform android` from `mobile/`.
- To try things without touching the real relay (the user often has one running on :3000, so leave it alone): start a throwaway relay with `PORT=3999 PATRIOT_PROFILES_FILE=<temp file> node --import tsx index.ts` from `relay/`, and the web client with `PATRIOT_RELAY_PORT=3999 node browser-chat.cjs`. Browser flows can be clicked through by driving headless Edge (`msedge --headless=new --remote-debugging-port=…`) over the DevTools protocol. No test harness is checked in.

## Rules for working in this repo
1. **Keep mobile and the browser client in sync.** Every user-facing feature or change goes into `mobile/` **and** `browser-chat.cjs`. Both are used in the demo.
2. **Protocol changes start in `shared/index.ts`.** Add the event name, types and validator there first, then the relay handler, then both clients. Never hard-code event strings in a client or the relay. Definitions both clients need (question lists, chart colors) also belong there.
3. **Level names are hard-coded outside `shared`.** `rooms` in `shared/index.ts` defines the levels (`Upper Level`, `Middle Level`, `Lower Levels`), but `relay/index.ts` (`publishPresence`) and `relay/reports.ts` (`levelTemperatures`, `incidentSnapshot`, `severeReports`) build `Record<Room, …>` literals by hand. If you add or rename a level, update those too, or better, derive them from `rooms`.
4. **Question order matters.** For each question in `reportQuestions`, the last choice counts as "severe" for warnings, and chart colors run green to red by choice index. Keep choices ordered from least to most severe, in `dailyLogQuestions` too.
5. **Relay state is in memory.** DMs, room history (last 100 per room), and reports are lost when the relay restarts. Only profiles persist. That's acceptable for the demo; don't add a database unless asked.
6. **Validate untrusted input on the relay** using the shared validators, and keep the auth-challenge flow and `authenticated` checks in every handler. Everything else can favor speed.
7. **Styling is a green terminal theme on both clients.** Mobile uses NativeWind `className`s with the `term-*` palette (`bg-term-panel`, `text-term-dim`, `border-term-line`, …) from `mobile/src/terminal-colors.json`. Don't reintroduce Tailwind grays/blues, and add `font-mono` to every new `Text`/`TextInput`. Code that needs a raw color imports the JSON. The browser uses the same values as CSS variables in the `:root` rule of its `<style>` block; change both together. SOS and warnings intentionally stay rose/amber. `app/index.tsx` has `POLISH 1/2/3` guide comments for visual edits; leave connection and send logic alone when making visual changes.

## Priorities
- **Demo-ready speed over robustness.** Visible, working features matter most. Shortcuts like in-memory state are fine.
- **The demo must keep working** on two surfaces: phones running Expo Go against a laptop relay over LAN, and the browser client on localhost:4173. Don't break either.
- The user is *somewhat familiar* with TypeScript, React Native/Expo and Socket.IO. Give brief explanations of non-obvious changes and use normal comments; no tutorials.

## Git workflow
- **Use feature branches and PRs**; don't commit straight to `main`. Commit or push only when asked. The user usually asks to "commit and push to a new branch" and merges the PRs on GitHub.
- If the work builds on a branch that isn't merged yet, branch from it (stacked) and say which PR has to be merged first.
- Teammates have pushed directly to `main` with `patch to …` messages. Don't rewrite their history.
- Before starting work, pull `main`, because teammates push often.

## Known gaps / ideas (not commitments)
- The project README describes the features; keep it current when features change.
- Phone-to-phone mesh (offline when the Directorate cuts the network) was the starter's planned "next milestone". `mobile/src/transport.ts` is the swap point.
- No forward secrecy, no persistent relay queue, no QR key verification, no push notifications.
- Accounts exist only on the device that created them (no key export/import). Removing an account leaves its profile on the relay (no delete event).
- The Daily log is private by choice. Anonymous level totals (e.g. "% skipped meals today") were considered for the food/outbreak pitch but not built.
- Mobile uses the platform's built-in monospace font; no custom terminal font is bundled.
