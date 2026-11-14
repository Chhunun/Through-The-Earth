# PatriotHacks Chat

Two phones exchange encrypted, one-to-one messages through a Socket.IO relay. This first milestone uses Wi-Fi or an internet connection to reach the relay. Phone-to-phone mesh routing is a future milestone, with the transport behind `mobile/src/transport.ts`.

## Start the demo

Use Node.js 22 or 24 and npm. The mobile project is pinned to Expo SDK 54. Use an SDK 54–compatible Expo Go client or an SDK 54 development build.

```sh
npm ci
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

## Work split

| Owner | Starting points | Next deliverable |
| --- | --- | --- |
| Person A | `relay/index.ts`, `mobile/src/crypto.ts` | Harden the relay for hosted use and add persistent queuing if needed. |
| Person B | `mobile/app/`, `mobile/src/chat.ts`, `mobile/src/storage.ts`, `mobile/src/transport.ts` | Save contacts and add QR verification. Add notifications and location check-ins after the two-phone demo. |
| Both | `shared/index.ts` | Coordinate changes to envelope fields and socket events. |

## Message flow

- On first launch the app generates a NaCl box keypair and stores the private key in SecureStore. The relay issues an encrypted challenge before allowing a socket to send or read queued messages for the public key.
- The sender encrypts the text and binds the message ID, participants, and timestamp inside the authenticated payload. The relay queues the encrypted envelope and acknowledges acceptance. This acknowledgement means the relay accepted the envelope.
- The recipient decrypts and verifies the envelope, commits it to SQLite, then acknowledges receipt so the relay can remove it. SQLite stores envelopes only. The UI decrypts them into memory at launch.
- The relay holds pending messages in memory, so a relay restart clears the queue. A send with an interrupted or timed-out acknowledgement has uncertain delivery. Persistent outgoing retries, delivery receipts, QR scanning, push, and location are future work. Public keys are pseudonyms. The relay can see routing metadata and timing. The demo uses long-lived keys and has no forward secrecy.

## Validation

`npm run check` type-checks the mobile and relay workspaces. For an Android bundle check, run `npx expo export --platform android` from `mobile/`.
