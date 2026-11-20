# Through The Earth

A community communication and early-warning app for the people of the Hollow (Patriot HackFest Fall 2026, "Life underground" track). Residents chat with their level, report conditions they observe, and get warned when their level is in trouble. Phones and a browser client connect through a Socket.IO relay. This milestone uses Wi-Fi or an internet connection to reach the relay. Phone-to-phone mesh routing is a future milestone, with the transport behind `mobile/src/transport.ts`.

## Features

- **Profiles:** each user picks a display name and a home level (Upper Level, Middle Level or Lower Levels). The relay saves profiles to `relay/profiles.local.json`. **Sign out** returns to the sign-in screen and keeps the device's identity, contacts and messages. The sign-in screen can also **switch to another account** saved on the same phone or browser, or add a new one. Each account has its own key, contacts and messages. **Remove** deletes an account's key and local data from that device after a confirmation (its relay profile stays).
- **Level channels:** a public chat room per level, showing who belongs to it and how many members are online.
- **Encrypted direct messages:** one-to-one NaCl-encrypted messages between public keys, with saved contacts.
- **Check-ins and SOS:** one-tap "I'm okay", "are you okay?" and "SOS — I need help" messages to contacts.
- **Level condition reports:** residents answer quick questions (air, power, lighting, supplies, illness, heat, lung symptoms) and can enter a measured temperature. Results are shown as charts per level.
- **Warnings:** when 2 or more reports within 60 minutes describe power or airflow problems, the level gets an incident announcement. Answers at the most severe level are posted as severe warnings to that level's channel.
- **Temperature bar:** the average reported temperature per level.
- **Daily log:** a third tab next to Chat and Status where residents record their sleep, mood, body health and meals for the day, with optional notes, and see past days. It is private: entries are stored on the device for the signed-in account and never sent to the relay. The questions are `dailyLogQuestions` in `shared/index.ts`.

## Look and feel

Both clients use a green-on-dark-green terminal theme with monospace text and outlined boxes. SOS and warnings stay red and amber so they stand out.

- **Mobile:** the palette is in `mobile/src/terminal-colors.json`, exposed to Tailwind as `bg-term-*`, `text-term-*` and `border-term-*` (for example `bg-term-panel`, `text-term-dim`). Add `font-mono` to new `Text` and `TextInput` elements.
- **Browser:** the same colors are CSS variables in the `:root` rule of the `<style>` block in `browser-chat.cjs`.

## Project layout

| Path | Purpose |
| --- | --- |
| `shared/index.ts` | Shared protocol: socket events, types, validators, report questions, level names. |
| `relay/` | Express + Socket.IO relay: auth, message queue, rooms, reports, warnings, profiles. |
| `mobile/` | Expo SDK 58 app (expo-router, NativeWind, Zustand, SQLite, SecureStore). |
| `browser-chat.cjs` | Web client with the same features as the mobile app, served at http://localhost:4173. |

## Start the demo

Use Node.js 22.13+ or 24.3+ within those major versions. The mobile project uses Expo SDK 58. Use an SDK 58–compatible Expo Go client or an SDK 58 development build.

```sh
npm ci --include=dev
npm run check
npm run relay
```

On another terminal, from the same repo:

```sh
cp mobile/.env.example mobile/.env
# Edit mobile/.env and replace the example IP with your laptop's LAN IP.
npm run start -w mobile -- --lan
```

Put both phones on the same Wi-Fi as the laptop and scan the Expo terminal QR. The relay URL must be reachable from both phones. Open `http://<laptop-LAN-IP>:3000/health` on each phone if the connection fails. For a hosted relay, set its HTTPS URL instead. Use the local HTTP setup on a trusted demo network.

1. On each phone, share its public key and paste the other phone's key into the recipient field. Compare the exchanged keys in person for the demo.
2. Send a message from each phone. Close one app, send a message to it, reopen it, and paste the sender's key again to see the queued message.
3. Restart the receiving app and paste the sender's key again to verify that the conversation restores from SQLite.

### Browser client

With the relay running, start the web client in another terminal:

```sh
node browser-chat.cjs
```

Open http://localhost:4173. Each browser profile or private window gets its own identity, so you can open two windows to simulate two residents. Set `PATRIOT_RELAY_PORT` if the relay isn't on port 3000.

## Adding a feature

1. Add event names, types and validators to `shared/index.ts`.
2. Handle the event in `relay/` and validate all input there.
3. Build the UI in **both** `mobile/` and `browser-chat.cjs`.
4. Run `npm run check`.

## Message flow

- On first launch the app generates a NaCl box keypair and stores the private key in SecureStore. The relay issues an encrypted challenge before allowing a socket to send or read queued messages for the public key.
- The sender encrypts the text and binds the message ID, participants, and timestamp inside the authenticated payload. The relay queues the encrypted envelope and acknowledges acceptance. This acknowledgement means the relay accepted the envelope.
- The recipient decrypts and verifies the envelope, commits it to SQLite, then acknowledges receipt so the relay can remove it. SQLite stores envelopes only. The UI decrypts them into memory at launch.
- The relay holds pending messages, room history and level reports in memory, so a relay restart clears them. Only profiles persist. A send with an interrupted or timed-out acknowledgement has uncertain delivery. Persistent outgoing retries, delivery receipts, QR scanning, push, and location are future work. Public keys are pseudonyms. The relay can see routing metadata and timing. The demo uses long-lived keys and has no forward secrecy.

## Validation

`npm run check` type-checks the mobile and relay workspaces. For an Android bundle check, run `npx expo export --platform android` from `mobile/`.
