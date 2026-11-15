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
import { events, isEnvelope, isPublicKey, parseChatProfile, profileEvents, profileLabel, rooms, roomEvents, parseLevelReport, reportEvents, reportPie, reportQuestions } from './shared/index.ts';

const field = (id) => document.getElementById(id);
const bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const base64 = (data) => btoa(String.fromCharCode(...data));
nacl.setPRNG((buffer, length) => buffer.set(crypto.getRandomValues(new Uint8Array(length))));
function browserIdentity() {
  const slot = 'patriothacks.identity.v1';
  try {
    const stored = localStorage.getItem(slot);
    if (stored) return nacl.box.keyPair.fromSecretKey(bytes(stored));
  } catch {}
  const pair = nacl.box.keyPair();
  try {
    localStorage.setItem(slot, base64(pair.secretKey));
  } catch {
    field('identity-note').textContent = 'Browser storage is unavailable. Your identity lasts until you reload.';
  }
  return pair;
}
const keys = browserIdentity();
const ownKey = base64(keys.publicKey);
field('public-key').value = ownKey;
let authenticated = false;
const seen = new Set();
let profiles = {};
let savingProfile = false;
let profilesReady = false;
let signedIn = false;
const homeLevel = field('home-level');
for (const room of rooms) homeLevel.add(new Option(room, room));

function authorLabel(key, fallback) {
  const profile = profiles[key];
  return profile ? profileLabel(profile) : fallback;
}

function updateSignIn() {
  const profile = profiles[ownKey];
  const ready = authenticated && profilesReady;
  field('sign-in-card').hidden = signedIn;
  field('existing-profile').hidden = signedIn || !ready || !profile;
  field('profile-details').hidden = !signedIn && (!ready || !!profile);
  field('profile-title').hidden = !signedIn;
  if (!signedIn && ready && !profile) field('profile-details').open = true;
  field('sign-in-name').textContent = profile ? profileLabel(profile) : '';
  field('continue-chat').disabled = !ready || !profile;
  field('sign-in-wait').hidden = ready;
}

function enterChat(profile) {
  signedIn = true;
  field('profile-details').open = false;
  field('chat-sidebar').hidden = false;
  field('chat-workspace').hidden = false;
  document.body.classList.remove('sign-in');
  updateSignIn();
  selectChannel(profile.level);
}

field('continue-chat').addEventListener('click', () => {
  if (authenticated && profilesReady && profiles[ownKey]) enterChat(profiles[ownKey]);
});

function updateProfileSummary() {
  updateSignIn();
  field('profile-title').textContent = authorLabel(ownKey, 'Set up profile');
  if (selectedRoom) renderRoom();
  else renderDirect();
  if (reportOpen) renderReports();
}

field('profile-details').addEventListener('toggle', () => {
  if (!field('profile-details').open) return;
  const profile = profiles[ownKey];
  field('display-name').value = profile?.name ?? '';
  homeLevel.value = profile?.level ?? '';
  field('profile-status').textContent = '';
});

field('profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!authenticated || savingProfile) return;
  const profile = parseChatProfile({ name: field('display-name').value, level: homeLevel.value });
  if (!profile) {
    field('profile-status').textContent = 'Enter a display name of 1–40 characters and choose a home level.';
    return;
  }
  savingProfile = true;
  field('save-profile').disabled = true;
  field('profile-status').textContent = '';
  try {
    const ack = await socket.timeout(5000).emitWithAck(profileEvents.save, profile);
    if (!ack.ok) throw new Error(ack.error);
    if (!signedIn) enterChat(profile);
    else field('profile-details').open = false;
  } catch (error) {
    field('profile-status').textContent = error.message;
  } finally {
    savingProfile = false;
    field('save-profile').disabled = !authenticated;
  }
});
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
let recentReports = [];
let visibleReports = 5;

function renderCharts(summary) {
  const charts = field('poll-charts');
  charts.replaceChildren();
  field('poll-results').hidden = !summary;
  if (!summary) return;
  field('poll-empty').hidden = summary.reports !== 0;
  field('poll-temperature').textContent = summary.temperatureCount
    ? 'Average measured temperature · ' + summary.averageTemperatureF.toFixed(1) +
      ' °F (' + summary.temperatureCount + ' readings)'
    : '';
  for (const { id, label, choices } of reportQuestions) {
    const slices = reportPie(summary.counts[id]);
    if (!slices.length) continue;
    const card = document.createElement('article');
    const title = document.createElement('strong');
    title.textContent = label;
    const details = document.createElement('div');
    details.className = 'pie-details';
    const pie = document.createElement('div');
    pie.className = 'poll-pie';
    pie.setAttribute('aria-hidden', 'true');
    pie.style.background = 'conic-gradient(' + slices
      .map(({ color, start, end }) => color + ' ' + start + 'deg ' + end + 'deg')
      .join(',') + ')';
    const legend = document.createElement('div');
    for (const { index, color, count, percent } of slices) {
      const row = document.createElement('div');
      const swatch = document.createElement('span');
      swatch.className = 'pie-swatch';
      swatch.style.backgroundColor = color;
      row.append(swatch, choices[index] + ' · ' + count + ' (' + percent + '%)');
      legend.append(row);
    }
    details.append(pie, legend);
    card.append(title, details);
    charts.append(card);
  }
}

function renderReports() {
  const list = field('report-feed');
  list.replaceChildren();
  for (const report of recentReports.slice(0, visibleReports)) {
    const card = document.createElement('article');
    const who = document.createElement('strong');
    who.textContent = authorLabel(report.reporter, report.reporter === ownKey ? 'You' : 'Reporter');
    const key = document.createElement('code');
    key.textContent = report.reporter;
    const date = document.createElement('time');
    date.dateTime = new Date(report.submittedAt).toISOString();
    date.textContent = new Date(report.submittedAt).toLocaleString();
    card.append(who, key, date);
    for (const { id, label } of reportQuestions) {
      if (!report.answers[id]) continue;
      const answer = document.createElement('div');
      answer.textContent = label + ' · ' + report.answers[id];
      card.append(answer);
    }
    if (report.temperatureF !== undefined) {
      const reading = document.createElement('div');
      reading.textContent = 'Measured temperature · ' + report.temperatureF + ' °F';
      card.append(reading);
    }
    list.append(card);
  }
  field('more-reports').hidden = recentReports.length <= visibleReports;
}
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
    field('empty-reports').hidden = true;
    renderCharts();
    recentReports = [];
    visibleReports = 5;
    renderReports();
    field('temperature').value = '';
    for (const select of questions.values()) {
      select.value = '';
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
    const { summary, own, recent } = result.view;
    renderCharts(summary);
    recentReports = recent;
    field('empty-reports').hidden = !!recent.length;
    renderReports();
    for (const [id, select] of questions) {
      if (hydrate) select.value = own.answers[id] ?? '';
    }
    if (hydrate) field('temperature').value = own.temperatureF ?? '';
    field('report-count').textContent = summary.reports + ' reports';
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
field('more-reports').addEventListener('click', () => {
  visibleReports += 5;
  renderReports();
});

function renderRoom() {
  field('messages').replaceChildren();
  const messages = roomMessages.get(selectedRoom) ?? [];
  for (const message of messages) {
    show(authorLabel(message.from, message.from === ownKey ? 'You' : 'From ' + message.from.slice(0, 10) + '…'), message.text);
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

function showDirect(key, text) {
  directMessages.push({ key, text });
  if (!selectedRoom) show(authorLabel(key, key === ownKey ? 'You' : 'From ' + key.slice(0, 10) + '…'), text);
}

function renderDirect() {
  field('messages').replaceChildren();
  for (const { key, text } of directMessages) {
    show(authorLabel(key, key === ownKey ? 'You' : 'From ' + key.slice(0, 10) + '…'), text);
  }
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
  else renderDirect();
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
  field('save-profile').disabled = !online || savingProfile;
  updateSignIn();
  field('report-fields').disabled = !online;
}

socket.on(profileEvents.snapshot, (snapshot) => {
  profiles = snapshot;
  profilesReady = true;
  updateProfileSummary();
});
socket.on(profileEvents.changed, (key, profile) => {
  profiles[key] = profile;
  updateProfileSummary();
});

socket.on('disconnect', () => {
  profilesReady = false;
  status(false, 'Relay offline');
});
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
      showDirect(message.from, body.text);
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
    showDirect(ownKey, text);
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
body.sign-in{grid-template-columns:minmax(0,1fr);place-items:center}
body.sign-in main{max-width:500px}
body.sign-in #profile-details{background:#303036;border-radius:12px;padding:16px}
#profile-details summary{cursor:pointer}
#profile-title[hidden]{display:none}
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
#poll-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
#poll-charts article{background:#303036;border-radius:8px;padding:12px}
.pie-details{display:flex;align-items:center;gap:12px;margin-top:8px;font-size:.9rem}
.poll-pie{width:96px;height:96px;border-radius:50%;flex:none}
.pie-swatch{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
#report-feed{display:grid;gap:8px;margin:12px 0}
#report-feed article{display:grid;gap:5px;background:#303036;padding:12px;border-radius:8px}
#report-feed code{overflow-wrap:anywhere;color:#d4d4d8}
#report-feed time{font-size:.85rem;color:#a1a1aa}
#report-fields{border:0;margin:0;padding:0}
#report-questions{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px}
#report-questions select{display:block;margin-top:5px}
</style>
<body class="sign-in">
<aside id="chat-sidebar" hidden>
<h1>PatriotHacks Chat</h1>
<nav id="channels" aria-label="Channels"></nav>
</aside>
<main>
<section id="sign-in-card">
<h2>Sign in to PatriotHacks</h2>
<p id="sign-in-wait">Waiting for your profile from the relay…</p>
<div id="existing-profile" hidden>
<p id="sign-in-name"></p>
<button type="button" id="continue-chat" disabled>Continue to chat</button>
</div>
</section>
<p id="status" role="status">Connecting to relay…</p>
<details id="profile-details" hidden>
<summary id="profile-title">Set up profile</summary>
<form id="profile-form">
<label for="display-name">Display name</label>
<input id="display-name" maxlength="40" required>
<label for="home-level">Home level</label>
<select id="home-level" required><option value="">Choose a level</option></select>
<p id="profile-status" role="status"></p>
<button type="submit" id="save-profile" disabled>Save profile</button>
</form>
</details>
<div id="chat-workspace" hidden>
<h2 id="channel-title">Direct chat</h2>
<label for="public-key">Your public key</label>
<div class="key"><input id="public-key" readonly><button id="copy" type="button">Copy</button></div>
<p id="identity-note">This browser profile keeps your chat identity on this PC.</p>
<div id="level-tabs" hidden>
<button type="button" id="chat-tab" aria-pressed="true">Chat</button>
<button type="button" id="announcements-tab" aria-pressed="false">Announcements</button>
</div>
<form id="report" hidden>
<h3>Level conditions</h3>
<p>Share what you observed. Submitting replaces your previous report for this level.</p>
<fieldset id="report-fields" disabled>
<section id="poll-results" hidden>
<h4>Poll results</h4>
<p id="poll-empty" hidden>No responses for this level yet.</p>
<div id="poll-charts"></div>
<p id="poll-temperature"></p>
</section>
<h4>Submitted reports</h4>
<p>Reports are visible with your public chat ID.</p>
<button type="button" id="refresh-report">Refresh reports</button>
<p id="empty-reports" hidden>No reports for this level yet.</p>
<div id="report-feed"></div>
<button type="button" id="more-reports" hidden>Show more reports</button>
<h4>Your report</h4>
<div id="report-questions"></div>
<label for="temperature">Measured temperature (°F, optional)</label>
<input id="temperature" type="number" min="-100" max="200" step="any">
<p id="report-count"></p>
<button type="submit">Submit report</button>

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
</div>
</main>
<script src="/browser-chat.js" defer></script>
</body>
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
