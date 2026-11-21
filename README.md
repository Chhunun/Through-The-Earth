# Through The Earth

**Community early warning and family safety for the people of the Hollow.**
Built for **Patriot HackFest Fall 2026** · Track: **Life underground** · Repo: *Abyss*

## The problem

It's 2087. Two billion people live in **the Hollow**, a stack of underground levels. The deeper you go, the hotter and darker it gets, and the lower levels lose power first. **The Directorate** controls the air, the network and movement between levels, and its public numbers don't match what residents see.

When the air stops moving or the water turns brown, residents have no trusted way to find out what is really happening on their level, to warn everyone else, or to find their family.

## Our solution

**Through The Earth** is one app that lets residents report what they see, warn each other in seconds, and reach their people. It runs on a phone (Expo) and in a browser. Both connect to a **community relay** that residents run on their own laptop, not on Directorate infrastructure.

It does four things:

1. **See what's really happening.** Residents report conditions on their level. The app turns those reports into charts, temperature readings and automatic early warnings.
2. **Warn everyone fast.** One button raises an air-cutout or unsafe-water warning that every resident sees. SOS sends a specific emergency; a flooding SOS alerts all three levels at once.
3. **Find and reach your people.** Level channels, end-to-end encrypted direct messages, one-tap check-ins, and location pings on a shared level map.
4. **Look after yourself.** A private daily log of sleep, mood, health and meals that never leaves the device.

## Track problems we address

The brief rewards one connected solution that covers several problems. Through The Earth covers ten of them:

| # | Problem | How Through The Earth helps |
| --- | --- | --- |
| 1 | Blackouts | Power, airflow and lighting reports. Two or more power or airflow reports within 60 minutes trigger an automatic early warning. Air-cutout warnings. Blackout markers on the level map. |
| 3 | Heat | Heat reports and measured temperatures, a per-level temperature bar, and an "It's too hot here" SOS. |
| 4 | Bad water | Unsafe-water warnings that reach every resident, and an "I need water" SOS. |
| 5 | Flooding | A flooding SOS that posts to all three levels at once. |
| 7 | Communication without the Directorate | Everything runs through a relay that residents host themselves. Level channels, plus direct messages that the relay can't read. |
| 8 | Families split up during blackouts | Check-ins ("I'm okay", "Are you okay?", "I need help") that queue until the network returns, an "I'm lost" SOS, a list of who is online, and live or emergency location pings on the level map. |
| 9 | Lung-sickness outbreaks | Reports of breathing symptoms and visibly ill people, charted per level and raised as alerts. |
| 10 | Medicine | An "I need medical attention" SOS. |
| 11 | Sunlight deprivation | The private daily log tracks sleep and mood over time. |
| 12 | Food | Supply reports, an "I urgently need food" SOS, and meals in the daily log. |

## Feature tour

### See what's really happening
- **Condition reports (Status tab):** residents answer quick questions about air, power, lighting, supplies, visible illness, heat and lung symptoms, and can add a measured temperature. Results appear as charts for each level.
- **Automatic alerts:** any answer worse than a question's best option becomes a level alert, marked *elevated*, or *severe* for the worst option. Repeated power or airflow reports trigger an **early warning**.
- **Temperature bar:** the average reported temperature for the level, on a cool-to-hot scale.
- **Level map (phone):** residents record walking routes with GPS, and overlapping recordings merge into the most-travelled path. Residents can drop **blackout** and **blocked passage** markers for everyone, or save private places for themselves.

### Warn everyone fast
- **⚠ Raise warning:** choose *Air cutout* or *Unsafe water*, pick the level, and optionally say where. Every signed-in resident sees an **Active warnings** banner on every screen, including the map. Others tap **Confirm** to add their voice, and you can **Clear mine** when the danger has passed. Each resident's warning expires after 60 minutes unless they renew it.
- **SOS:** choose *I need help*, *I'm lost*, *medical*, *too hot*, *food*, *water*, or *flooding*. If you don't choose, the general SOS sends automatically after 5 seconds. A flooding SOS goes to all three levels.

### Find and reach your people
- **Level channels:** a group chat for each level, with live online counts and a list of who is online.
- **Direct messages:** one-to-one messages encrypted end to end with NaCl, plus saved contacts.
- **Check-ins:** one tap to send "I'm okay", ask "Are you okay?" or say "I need help". Check-ins wait in a queue and send when the connection comes back.
- **Location pings (phone):** share your position on the level map once, live as you move, or as an **emergency ping**. Your own position stays private until you choose to ping.

### Look after yourself
- **Daily log:** record sleep, mood, body health and meals each day, and look back over past days. It is stored only on the device and is never sent to the relay.

### Built for the people who use it
- **Shared devices:** several residents can keep accounts on one phone or browser and switch between them. Each account keeps its own messages, contacts and daily log.
- **Readable in the dark:** a high-contrast green terminal theme with monospace text. Alerts stay amber and red so they stand out.
- **Works on a phone or a laptop:** the browser client has every feature except the map and the list of who is online.

## How it works

```
 Phone app (Expo) ──┐                          ┌─ in memory: chat history, reports,
                    ├──► Community relay ──────┤   warnings, SOS, location pings
 Browser client ────┘   (Node.js on a laptop)  └─ saved to disk: profiles, map routes and markers
```

| Part | Built with |
| --- | --- |
| Phone app | Expo SDK 58, React Native, expo-router, NativeWind (Tailwind), Zustand, expo-sqlite, expo-location |
| Browser client | One self-contained file, bundled with esbuild and served at http://localhost:4173 |
| Relay | Node.js, Express and Socket.IO, with the map stored in SQLite |
| Shared protocol | A TypeScript package (`shared/`) that defines every event, type and input check, used by all three |
| Encryption | TweetNaCl: a key pair for each account, challenge-based sign-in, and encrypted direct messages |

**Privacy and safety**
- **No passwords:** an account is a key pair generated on the device. The relay checks that you hold the key before accepting anything from you.
- **Private messages stay private:** direct messages and check-ins are encrypted on the device, so the relay can't read them.
- **Public by choice:** channels, reports, warnings and SOS are public to residents on purpose. A map route or marker is shared only when you choose to share it.
- **Location:** your live position stays on your phone until you ping it. A ping expires 60 seconds after its last update.
- **Daily log:** it never leaves the device.
- **Untrusted input:** the relay validates every request before acting on it.

## Run it yourself

**You need:** Node.js 22.13+ or 24.3+, a phone with **Expo Go** (SDK 58), and the laptop and phone on the **same Wi-Fi**.

Run every command from the code folder:

```sh
cd PatriotHacks_Chat_Starter_SDK58/patriothacks-chat
npm ci --include=dev                  # first time only
```

1. **Point the phone app at your laptop (first time only).** Copy `mobile/.env.example` to `mobile/.env`, then set `EXPO_PUBLIC_RELAY_URL=http://<your-laptop-IP>:3000`. To find the IP, run `ipconfig` on Windows (Wi-Fi IPv4 address) or `ipconfig getifaddr en0` on macOS.
2. **Start the relay** (terminal 1): `npm run relay`. It prints `Through The Earth relay listening on …`.
3. **Start Expo** (terminal 2): `npm run start -w mobile -- --lan`. On Android, scan the QR code with Expo Go. On iPhone, scan it with the Camera app.
4. **Start the browser client** (terminal 3): `node browser-chat.cjs`, then open http://localhost:4173. Each browser profile or private window is a separate resident.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| The app can't reach the relay | On the phone's browser, open `http://<your-laptop-IP>:3000/health`. You should see `{"ok":true}`. If you don't, the phone can't reach the laptop; see the next rows. |
| Windows blocks the connection | When Windows Firewall asks about Node.js, allow it on **Private** networks, and set your Wi-Fi to *Private*. |
| Venue Wi-Fi blocks devices from reaching each other | Connect the laptop to a phone hotspot, put the new IP in `mobile/.env`, and restart Expo. |
| A change to `mobile/.env` has no effect | Restart Expo with a clean cache: `npm run start -w mobile -- --lan --clear` |
| "Unable to resolve module" after pulling | Run `npm ci --include=dev` again, then restart Expo with `--clear`. |

## What's next

- **Phone-to-phone mesh:** keep messages and warnings moving when the Directorate cuts the network. The transport layer (`mobile/src/transport.ts`) is already isolated for this.
- **Anonymous level totals from daily logs:** for example, "40% of the Lower Levels skipped meals today", for food and outbreak planning without exposing anyone's log.
- **The remaining track problems:** fair rationing (2), crowding (6), surface safety (13), and surface outposts and migration (14).
- **Stronger security:** forward secrecy, verifying contacts by QR code, and a relay queue that survives restarts.

## For developers

- Code: [`PatriotHacks_Chat_Starter_SDK58/patriothacks-chat/`](PatriotHacks_Chat_Starter_SDK58/patriothacks-chat/), an npm-workspaces monorepo (`shared/`, `relay/`, `mobile/`, `browser-chat.cjs`). Developer notes and the encryption flow are in its [README](PatriotHacks_Chat_Starter_SDK58/patriothacks-chat/README.md).
- `npm run check` type-checks the phone app and the relay. Run it after every change.
- New features start in `shared/` (events, types, validators), then go to the relay, then to **both** the phone app and the browser client.
