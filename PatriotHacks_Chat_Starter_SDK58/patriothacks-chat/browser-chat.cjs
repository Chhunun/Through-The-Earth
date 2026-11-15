const { createServer } = require('node:http');
const { buildSync } = require('esbuild');

const relay = 'http://127.0.0.1:' + (process.env.PATRIOT_RELAY_PORT || '3000');
const browserCode = buildSync({
  bundle: true,
  write: false,
  platform: 'browser',
  stdin: {
    resolveDir: __dirname,
    sourcefile: 'browser-chat.js',
    contents: String.raw`
import { io } from 'socket.io-client';
import nacl from 'tweetnacl';
import { events, isEnvelope, isPublicKey, rooms, roomEvents, parseLevelReport, reportEvents, reportQuestions } from './shared/index.ts';

const field = (id) => document.getElementById(id);
const bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const base64 = (data) => btoa(String.fromCharCode(...data));
nacl.setPRNG((buffer, length) => buffer.set(crypto.getRandomValues(new Uint8Array(length))));
const keys = nacl.box.keyPair();
const ownKey = base64(keys.publicKey);
field('public-key').value = ownKey;
let authenticated = false;
const seen = new Set();
const channelButtons = new Map();
for (const channel of [...rooms, '']) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = channel ? '#  ' + channel : 'Direct chat';
  button.setAttribute('aria-pressed', String(!channel));
  button.addEventListener('click', () => selectChannel(channel));
  channelButtons.set(channel, button);
  field('channels').append(button);
}
const roomMessages = new Map();
const directMessages = [];
let selectedRoom = '';
let reportOpen = false;
let reportRequest = 0;
const questions = new Map();
for (const { id, label, choices } of reportQuestions) {
  const row = document.createElement('label');
  row.textContent = label;
  const select = document.createElement('select');
  select.add(new Option('Not answered', ''));
  for (const choice of choices) select.add(new Option(choice, choice));
  row.append(select);
  field('report-questions').append(row);
  questions.set(id, select);
}

function selectTab(announcements) {
  reportOpen = announcements;
  reportRequest++;
  field('chat').hidden = announcements;
  field('report').hidden = !announcements;
  field('chat-tab').setAttribute('aria-pressed', String(!announcements));
  field('announcements-tab').setAttribute('aria-pressed', String(announcements));
  if (announcements) {
    field('report-status').textContent = '';
    field('report-count').textContent = '';
    field('temperature').value = '';
    for (const select of questions.values()) {
      select.value = '';
      for (const option of [...select.options].slice(1)) option.textContent = option.value;
    }
    void updateReport({ hydrate: true });
  }
}

async function updateReport({ submit = false, hydrate = false } = {}) {
  if (!authenticated || !selectedRoom || !reportOpen) return;
  const requestId = ++reportRequest;
  const fields = field('report-fields');
  fields.disabled = true;
  field('report-status').textContent = '';
  try {
    const request = socket.timeout(5000);
    const answers = Object.fromEntries([...questions]
      .filter(([, select]) => select.value)
      .map(([id, select]) => [id, select.value]));
    const result = submit
      ? await request.emitWithAck(reportEvents.submit, selectedRoom, parseLevelReport(answers, field('temperature').value))
      : await request.emitWithAck(reportEvents.read, selectedRoom);
    if (requestId !== reportRequest) return;
    if (!result.ok) throw new Error(result.error);
    const { summary, own } = result.view;
    for (const [id, select] of questions) {
      if (hydrate) select.value = own.answers[id] ?? '';
      for (const [index, option] of [...select.options].slice(1).entries()) {
        option.textContent = option.value + ' · ' + summary.counts[id][index];
      }
    }
    if (hydrate) field('temperature').value = own.temperatureF ?? '';
    field('report-count').textContent = summary.reports + ' reports' +
      (summary.temperatureCount ? ' · Average ' + summary.averageTemperatureF.toFixed(1) + ' °F (' + summary.temperatureCount + ' readings)' : '');
    if (submit) field('report-status').textContent = 'Report saved.';
  } catch (error) {
    if (requestId === reportRequest) field('report-status').textContent = error.message;
  } finally {
    if (requestId === reportRequest) fields.disabled = !authenticated;
  }
}

field('chat-tab').addEventListener('click', () => selectTab(false));
field('announcements-tab').addEventListener('click', () => {
  if (!reportOpen) selectTab(true);
});
field('report').addEventListener('submit', (event) => {
  event.preventDefault();
  void updateReport({ submit: true });
});
field('refresh-report').addEventListener('click', () => updateReport());

function renderRoom() {
  field('messages').replaceChildren();
  const messages = roomMessages.get(selectedRoom) ?? [];
  for (const message of messages) {
    show(message.from === ownKey ? 'You' : 'From ' + message.from.slice(0, 10) + '…', message.text);
  }
}

function mergeRoom(room, history, live) {
  const merged = new Map(history.map((message) => [message.id, message]));
  for (const message of roomMessages.get(room) ?? []) merged.set(message.id, message);
  if (live) merged.set(live.id, live);
  roomMessages.set(room, [...merged.values()].slice(-100));
  if (room === selectedRoom) renderRoom();
}

async function loadRoom(room) {
  if (!room || !authenticated) return;
  try {
    const history = await socket.timeout(5000).emitWithAck(roomEvents.history, room);
    mergeRoom(room, history);
  } catch {
    if (room === selectedRoom) field('error').textContent = 'Could not load room history. Check that the updated relay is running.';
  }
}

function showDirect(label, text) {
  directMessages.push({ label, text });
  if (!selectedRoom) show(label, text);
}

function selectChannel(channel) {
  if (channel === selectedRoom) return;
  selectedRoom = channel;
  field('level-tabs').hidden = !channel;
  selectTab(false);
  for (const [name, button] of channelButtons) {
    button.setAttribute('aria-pressed', String(name === channel));
  }
  field('channel-title').textContent = channel ? '# ' + channel : 'Direct chat';
  field('direct').hidden = !!selectedRoom;
  field('room-note').hidden = !selectedRoom;
  field('recipient').required = !selectedRoom;
  field('draft').value = '';
  field('error').textContent = '';
  if (selectedRoom) renderRoom();
  else {
    field('messages').replaceChildren();
    for (const { label, text } of directMessages) show(label, text);
  }
  void loadRoom(selectedRoom);
}
const socket = io(` + JSON.stringify(relay) + String.raw`, {
  transports: ['websocket'],
  auth: { publicKey: ownKey },
});

function status(online, message) {
  authenticated = online;
  field('status').textContent = message;
  field('send').disabled = !online;
  field('report-fields').disabled = !online;
}

socket.on('disconnect', () => status(false, 'Relay offline'));
socket.on('connect_error', () => status(false, 'Cannot reach the relay. Check that it is running.'));
socket.on(events.challenge, async (challenge) => {
  const connection = socket.id;
  try {
    const proof = nacl.box.open(bytes(challenge.ciphertext), bytes(challenge.nonce),
      bytes(challenge.publicKey), keys.secretKey);
    if (!proof || proof.length !== 32) throw new Error('Invalid relay challenge');
    const ack = await socket.timeout(5000).emitWithAck(events.authenticate, base64(proof));
    if (!ack.ok) throw new Error(ack.error);
    if (socket.id === connection) {
      status(true, 'Relay connected');
      void loadRoom(selectedRoom);
      if (reportOpen) void updateReport({ hydrate: true });
    }
  } catch (error) {
    if (socket.id === connection) status(false, error.message);
  }
});

function show(label, text) {
  const line = document.createElement('li');
  line.textContent = label + ': ' + text;
  field('messages').append(line);
  line.scrollIntoView({ block: 'nearest' });
}

socket.on(roomEvents.message, (message) => mergeRoom(message.room, [], message));

socket.on(events.receive, (message) => {
  if (!isEnvelope(message) || message.to !== ownKey) return;
  try {
    const plaintext = nacl.box.open(bytes(message.ciphertext), bytes(message.nonce),
      bytes(message.from), keys.secretKey);
    if (!plaintext) return;
    const body = JSON.parse(new TextDecoder().decode(plaintext));
    if (body.id !== message.id || body.from !== message.from || body.to !== message.to ||
        body.sentAt !== message.sentAt || typeof body.text !== 'string') return;
    const deliveryId = message.from + ':' + message.id;
    if (!seen.has(deliveryId)) {
      showDirect('From ' + message.from.slice(0, 10) + '…', body.text);
      seen.add(deliveryId);
    }
    socket.emit(events.received, message.from, message.id);
  } catch {
    field('error').textContent = 'Could not read an incoming message.';
  }
});

field('chat').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!authenticated || field('send').disabled) return;
  field('error').textContent = '';
  const to = field('recipient').value.trim();
  const draft = field('draft');
  const text = draft.value.trim();
  const room = selectedRoom;
  if (!room && (!isPublicKey(to) || to === ownKey)) {
    field('error').textContent = 'Paste the other device’s public key.';
    return;
  }
  if (!text) return;
  field('send').disabled = true;
  try {
    if (room) {
      const ack = await socket.timeout(5000).emitWithAck(roomEvents.send, room, text);
      if (!ack.ok) throw new Error(ack.error);
      if (selectedRoom === room && draft.value.trim() === text) draft.value = '';
      return;
    }
    const id = crypto.randomUUID();
    const sentAt = Date.now();
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const plaintext = new TextEncoder().encode(JSON.stringify({ id, from: ownKey, to, sentAt, text }));
    const ciphertext = nacl.box(plaintext, nonce, bytes(to), keys.secretKey);
    const message = { v: 1, id, from: ownKey, to, sentAt, nonce: base64(nonce), ciphertext: base64(ciphertext) };
    const ack = await socket.timeout(5000).emitWithAck(events.send, message);
    if (!ack.ok) throw new Error(ack.error);
    showDirect('You', text);
    if (!selectedRoom && draft.value.trim() === text) draft.value = '';
  } catch (error) {
    field('error').textContent = error.message;
  } finally {
    field('send').disabled = !authenticated;
  }
});

field('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ownKey);
    field('copy').textContent = 'Copied';
  } catch {
    field('public-key').select();
  }
});
`,
  },
}).outputFiles[0].text;

const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PatriotHacks Chat</title>
<style>
*{box-sizing:border-box}
body{background:#101822;color:#edf3fa;font:16px system-ui;margin:0}
body{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh;background:#222226}
aside{background:#18181b;padding:20px 10px}
aside h1{font-size:1rem;padding:0 8px 12px}
nav{display:grid;gap:4px}
nav button{background:transparent;border:0;color:#a1a1aa;text-align:left}
nav button:hover,nav button[aria-pressed="true"]{background:#36363d;color:#f4f4f5}
nav button[aria-pressed="true"]{font-weight:600}
main{max-width:850px;width:100%;padding:24px}
@media(max-width:600px){body{grid-template-columns:1fr}nav{display:flex;flex-wrap:wrap}main{padding:16px}}
h1{margin:0}p{color:#b9c9d9}
label{display:block;margin:16px 0 6px}
input,textarea,button,select{font:inherit;padding:10px;border:1px solid #52667b;border-radius:6px}
input,textarea,select{background:#1f2d3c;color:inherit;width:100%}
button{background:#a6e6ce;color:#102624;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.key{display:flex;gap:8px}
ul{min-height:120px;max-height:40vh;overflow:auto;padding:12px 12px 12px 32px;background:#172230;border-radius:6px}
li{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:8px}
#error{color:#ffbaad}
#level-tabs button{background:#36363d;color:white;margin-right:6px}
#level-tabs button[aria-pressed="true"]{background:#a6e6ce;color:#102624}
#report-fields{border:0;margin:0;padding:0}
#report-questions{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px}
#report-questions select{display:block;margin-top:5px}
</style>
<aside>
<h1>PatriotHacks Chat</h1>
<nav id="channels" aria-label="Channels"></nav>
</aside>
<main>
<h2 id="channel-title">Direct chat</h2>
<p id="status" role="status">Connecting to relay…</p>
<label for="public-key">Your public key</label>
<div class="key"><input id="public-key" readonly><button id="copy" type="button">Copy</button></div>
<p>Reloading this tab creates a new key and clears the chat.</p>
<div id="level-tabs" hidden>
<button type="button" id="chat-tab" aria-pressed="true">Chat</button>
<button type="button" id="announcements-tab" aria-pressed="false">Announcements</button>
</div>
<form id="report" hidden>
<h3>Level conditions</h3>
<p>Share what you observed. Submitting replaces your previous report for this level.</p>
<fieldset id="report-fields" disabled>
<div id="report-questions"></div>
<label for="temperature">Measured temperature (°F, optional)</label>
<input id="temperature" type="number" min="-100" max="200" step="any">
<p id="report-count"></p>
<button type="submit">Submit report</button>
<button type="button" id="refresh-report">Refresh totals</button>
</fieldset>
<p id="report-status" role="status"></p>
</form>
<form id="chat">
<p id="room-note" hidden>Open demo room · Messages are visible to the relay.</p>
<div id="direct">
<label for="recipient">Recipient public key</label>
<input id="recipient" spellcheck="false" autocomplete="off" required>
</div>
<ul id="messages" aria-label="Messages" aria-live="polite"></ul>
<label for="draft">Message</label>
<textarea id="draft" rows="3" maxlength="2000" required></textarea>
<p id="error" role="alert"></p>
<button id="send" disabled>Send</button>
</form>
</main>
<script src="/browser-chat.js" defer></script>
</html>`;

createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
  } else if (request.url === '/browser-chat.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(browserCode);
  } else {
    response.writeHead(404).end();
  }
}).listen(4173, '127.0.0.1', () => {
  console.log('Open http://localhost:4173 in your browser. Leave this terminal open.');
});
