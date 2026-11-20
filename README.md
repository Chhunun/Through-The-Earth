# Abyss

A community communication and early-warning app for the Hollow, built for **Patriot HackFest Fall 2026** (track: "Life underground").

In 2087, two billion people live in the Hollow, a stack of underground levels whose power, air and water systems are failing. The government (the Directorate) controls the network, and its public numbers don't match what residents see. Abyss lets residents see the real conditions on their level, warn each other, and check on family.

## Features

| Feature | What it does | Track problems |
| --- | --- | --- |
| **Profiles** | Each resident picks a display name and a home level: Upper Level, Middle Level or Lower Levels. | — |
| **Level channels** | A group chat for each level, showing who lives there and how many are online. | 7 (organizing without the Directorate) |
| **Direct messages** | One-to-one messages, encrypted end to end, with saved contacts. | 7, 8 |
| **Check-ins and SOS** | One-tap "I'm okay", "Are you okay?" and "SOS — I need help" messages. | 8 (finding family during blackouts) |
| **Condition reports** | Residents report air, power, lighting, supplies, visible illness, heat and lung symptoms, plus an optional measured temperature. Results show as charts per level. | 1, 3, 9 |
| **Automatic warnings** | 2 or more power or airflow reports from a level within 60 minutes create an incident announcement. The most severe answers are posted as warnings in that level's channel. | 1 (warning before power or air fails), 9 |
| **Temperature bar** | The average temperature residents reported for each level. | 3 (heat in the deep levels) |
| **Hazard warnings** | A "⚠ Raise warning" button alerts every signed-in resident to an air cutout or bad water on a level, with an optional note on where. Others can confirm it. Each resident's warning lasts 60 minutes unless they renew or clear it. | 1 (air), 4 (bad water) |
| **Daily log** | A private record of sleep, mood, body health and meals. It stays on the device and is never sent to the relay. | 11, 12 |

## How it works

```
 Phone (Expo app) ─┐
                    ├──► Relay server (laptop, port 3000) ──► broadcasts messages, reports, warnings
 Browser client ───┘
```

All code is in [`PatriotHacks_Chat_Starter_SDK58/patriothacks-chat/`](PatriotHacks_Chat_Starter_SDK58/patriothacks-chat/), an npm-workspaces monorepo:

| Path | Purpose |
| --- | --- |
| `shared/index.ts` | The shared protocol: socket event names, types, input validators, report questions and level names. |
| `relay/` | Node.js server (Express + Socket.IO). It verifies identities, queues direct messages, runs the level channels, and collects reports and turns them into warnings. |
| `mobile/` | The phone app: Expo SDK 58, expo-router, NativeWind (Tailwind) and Zustand. |
| `browser-chat.cjs` | A web version of the app with the same features, served at http://localhost:4173. |

**Data and privacy**
- Each device creates its own encryption keypair on first launch; the public key is the user's identity.
- Direct messages are encrypted with NaCl, so the relay can't read them.
- Level channels, reports and hazard warnings are visible to everyone.
- The relay keeps messages, channel history, reports and hazard warnings in memory, so restarting it clears them. Only profiles are saved, to `relay/profiles.local.json`.

## Requirements

- **Node.js** 22.13+ or 24.3+
- **Expo Go** on your phone, in a version that supports **SDK 58**. Get it from the App Store or Google Play.
- The laptop and phone(s) on the **same Wi-Fi network**

## Running the Expo app

Run every command from the code folder:

```sh
cd PatriotHacks_Chat_Starter_SDK58/patriothacks-chat
```

### 1. Install dependencies (first time only)

```sh
npm ci --include=dev
```

### 2. Point the app at your laptop (first time only)

Copy the example environment file.

macOS / Linux:
```sh
cp mobile/.env.example mobile/.env
```

Windows (PowerShell):
```powershell
Copy-Item mobile\.env.example mobile\.env
```

Find your laptop's IP address on the Wi-Fi network:
- **Windows:** run `ipconfig` and look under "Wireless LAN adapter Wi-Fi" for the IPv4 address.
- **macOS:** run `ipconfig getifaddr en0`.

Then edit `mobile/.env` and put that address in:

```
EXPO_PUBLIC_RELAY_URL=http://<your-laptop-IP>:3000
```

### 3. Start the relay server (terminal 1)

```sh
npm run relay
```

Leave it running. You should see `Through The Earth relay listening on ...`.

### 4. Start Expo (terminal 2)

```sh
npm run start -w mobile -- --lan
```

Expo prints a QR code.

### 5. Open the app on your phone

- **Android:** open Expo Go and scan the QR code.
- **iPhone:** scan the QR code with the Camera app, then tap the Expo Go prompt.

Create a profile with a name and home level, and you're in. Repeat on a second phone to chat between devices.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| The app says it can't reach the relay | On the phone's browser, open `http://<your-laptop-IP>:3000/health`. You should see `{"ok":true}`. If you don't, the phone can't reach the laptop; see the next rows. |
| Windows blocks the connection | When Windows Firewall asks about Node.js, allow it on **Private** networks. Make sure your Wi-Fi is set to *Private*, not *Public*, in Windows settings. |
| Venue or campus Wi-Fi blocks devices from reaching each other | Connect the laptop to your phone's hotspot, put the new IP in `mobile/.env`, and restart Expo. (Expo's `--tunnel` only fixes loading the app, not reaching the relay.) |
| You changed `mobile/.env` but nothing changed | The URL is fixed when the app is built. Restart Expo with a clean cache: `npm run start -w mobile -- --lan --clear` |
| Expo Go says the SDK version isn't supported | Update Expo Go to a version that supports SDK 58. |

## Running the browser client

With the relay running, open a third terminal in the same folder:

```sh
node browser-chat.cjs
```

Open http://localhost:4173. Each browser profile or private window gets its own identity, so you can open two windows to act as two residents. Tabs in the same window share one identity.

## Demo walkthrough

1. Start the relay, Expo and the browser client.
2. On a phone and in the browser, create profiles on the **same level** (for example, Lower Levels).
3. Chat in the level channel and watch the online count update.
4. Copy one user's public key into the other's contacts and send a direct message, a check-in and an SOS.
5. From two different users, submit reports with power or airflow problems. A warning appears for that level.
6. Submit reports with temperatures and watch the level's temperature bar update.

## Development

- `npm run check` type-checks the mobile app and the relay. There are no automated tests, so run it after every change.
- To add a feature:
  1. Define the socket events, types and validators in `shared/index.ts`.
  2. Handle the events in `relay/`, validating all input there.
  3. Build the UI in **both** `mobile/` and `browser-chat.cjs`.
- Work on feature branches and open pull requests instead of pushing to `main`.

More detail on the message encryption flow is in [`patriothacks-chat/README.md`](PatriotHacks_Chat_Starter_SDK58/patriothacks-chat/README.md).
