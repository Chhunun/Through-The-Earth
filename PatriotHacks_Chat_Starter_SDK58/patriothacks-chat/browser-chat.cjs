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
import { events, isEnvelope, isPublicKey, parseChatProfile, profileEvents, profileLabel, rooms, roomEvents, parseLevelReport, reportEvents, reportPie, reportQuestions, sosMessage, checkInMessages, checkInStatus, incidentEvent, incidentLabels, incidentWindowMinutes, localClock, dailyLogQuestions, dailyLogDay, dailyLogDayLabel, dailyLogNotesLimit, parseDailyLogEntry, hazardKinds, hazardLabels, parseWarningRequest, warningActiveMinutes, warningEvents, warningNoteLimit } from './shared/index.ts';

const field = (id) => document.getElementById(id);
function refreshClock() {
  const { date, time } = localClock();
  const label = date + ' · ' + time;
  const clock = field('local-clock');
  if (clock.textContent !== label) clock.textContent = label;
}
refreshClock();
setInterval(refreshClock, 1000);
document.addEventListener('visibilitychange', refreshClock);

const bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const base64 = (data) => btoa(String.fromCharCode(...data));
nacl.setPRNG((buffer, length) => buffer.set(crypto.getRandomValues(new Uint8Array(length))));
// The active account's secret key. Older builds only had this slot, so it stays the source of truth.
const identitySlot = 'patriothacks.identity.v1';
// Every account saved in this browser, as base64 secret keys in the order they were added.
const accountsSlot = 'patriothacks.accounts.v1';
// Set just before a reload so the chosen account goes straight to its chat.
const autoSignInSlot = 'patriothacks.auto-sign-in';
function browserIdentity() {
  try {
    const stored = localStorage.getItem(identitySlot);
    if (stored) return nacl.box.keyPair.fromSecretKey(bytes(stored));
  } catch {}
  const pair = nacl.box.keyPair();
  try {
    localStorage.setItem(identitySlot, base64(pair.secretKey));
  } catch {
    field('identity-note').textContent = 'Browser storage is unavailable. Your identity lasts until you reload.';
  }
  return pair;
}
const keys = browserIdentity();
const ownKey = base64(keys.publicKey);

function savedSecrets() {
  try {
    const list = JSON.parse(localStorage.getItem(accountsSlot) ?? '[]');
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
const accountSecrets = savedSecrets();
if (!accountSecrets.includes(base64(keys.secretKey))) {
  accountSecrets.push(base64(keys.secretKey));
  try { localStorage.setItem(accountsSlot, JSON.stringify(accountSecrets)); } catch {}
}
const otherAccounts = accountSecrets
  .map((secret) => ({ secret, key: base64(nacl.box.keyPair.fromSecretKey(bytes(secret)).publicKey) }))
  .filter(({ key }) => key !== ownKey);

// Switching saves the new active key and reloads, so every per-account slot below is rebuilt for it.
function activateAccount(secret, autoSignIn) {
  try {
    localStorage.setItem(identitySlot, secret);
    if (autoSignIn) sessionStorage.setItem(autoSignInSlot, '1');
  } catch {
    field('error').textContent = 'Browser storage is unavailable, so accounts cannot be switched.';
    return;
  }
  location.reload();
}
let autoSignIn = false;
try {
  autoSignIn = sessionStorage.getItem(autoSignInSlot) === '1';
  sessionStorage.removeItem(autoSignInSlot);
} catch {}
field('public-key').value = ownKey;
const contactsSlot = 'patriothacks.contacts.v1:' + ownKey;

function loadContacts() {
  try {
    const entries = JSON.parse(localStorage.getItem(contactsSlot) ?? '[]');
    if (Array.isArray(entries)) return [...new Set(entries.filter((key) => isPublicKey(key) && key !== ownKey))];
  } catch {
    field('contact-status').textContent = 'Could not load saved contacts.';
  }
  return [];
}

let contacts = loadContacts();
const outboxSlot = 'patriothacks.check-ins.outbox:' + ownKey;
const receivedSlot = 'patriothacks.check-ins.received:' + ownKey;

function readCheckIns(slot) {
  try {
    const value = JSON.parse(localStorage.getItem(slot) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let checkInOutbox = readCheckIns(outboxSlot).filter((item) => isEnvelope(item) && item.from === ownKey);
const lastCheckIns = new Map(readCheckIns(receivedSlot).filter((item) =>
  Array.isArray(item) && isPublicKey(item[0]) && Number.isFinite(item[1]?.sentAt) &&
  ['I’m okay', 'Needs help'].includes(item[1]?.status)));
let flushingCheckIns = false;

function renderCheckIn() {
  const recipient = field('recipient').value.trim();
  field('check-in').hidden = !!selectedRoom || !isPublicKey(recipient) || recipient === ownKey;
  const latest = lastCheckIns.get(recipient);
  field('check-in-latest').textContent = latest
    ? 'Last check-in · ' + latest.status + ' · ' + new Date(latest.sentAt).toLocaleString()
    : 'No check-in received from this contact.';
  const pending = checkInOutbox.filter((message) => message.to === recipient).length;
  field('check-in-pending').textContent = pending
    ? pending + (pending === 1 ? ' check-in queued' : ' check-ins queued') +
      (authenticated ? ' · Waiting to send' : ' · Waiting for connection')
    : '';
}

function rememberCheckIn(message, text) {
  const status = checkInStatus(text);
  if (!status || (lastCheckIns.get(message.from)?.sentAt ?? 0) > message.sentAt) return;
  lastCheckIns.set(message.from, { status, sentAt: message.sentAt });
  try {
    localStorage.setItem(receivedSlot, JSON.stringify([...lastCheckIns]));
  } catch {
    field('check-in-pending').textContent = 'Your browser could not store this check-in.';
  }
  renderCheckIn();
}

function setOutbox(next) {
  localStorage.setItem(outboxSlot, JSON.stringify(next));
  checkInOutbox = next;
  renderCheckIn();
}

async function flushCheckIns() {
  if (!authenticated || flushingCheckIns) return;
  flushingCheckIns = true;
  try {
    for (const message of checkInOutbox) {
      if (!authenticated) break;
      await sendDirectEnvelope(message);
      const plaintext = nacl.box.open(bytes(message.ciphertext), bytes(message.nonce), bytes(message.to), keys.secretKey);
      if (plaintext) showDirect(ownKey, message.to, JSON.parse(new TextDecoder().decode(plaintext)).text);
      setOutbox(checkInOutbox.filter((item) => item.id !== message.id));
    }
  } catch {
    // Keep the original encrypted envelope queued for retry.
  } finally {
    flushingCheckIns = false;
  }
}

for (const [kind, id] of [['okay', 'check-in-okay'], ['request', 'check-in-request'], ['help', 'check-in-help']]) {
  field(id).addEventListener('click', () => {
    const to = field('recipient').value.trim();
    if (selectedRoom || !isPublicKey(to) || to === ownKey) return;
    if (kind === 'help' && !window.confirm('Send an in-app SOS to this contact?')) return;
    field('error').textContent = '';
    try {
      setOutbox([...checkInOutbox, makeDirectEnvelope(to, checkInMessages[kind])]);
      void flushCheckIns();
    } catch {
      field('error').textContent = 'Could not save this check-in to the queue.';
    }
  });
}
const recentPeers = new Set();

function renderContacts() {
  const list = field('saved-contacts');
  const recipient = field('recipient').value.trim();
  list.replaceChildren();
  field('contact-list').hidden = contacts.length === 0;
  field('toggle-contact').hidden = !isPublicKey(recipient) || recipient === ownKey;
  field('toggle-contact').textContent = contacts.includes(recipient) ? 'Remove contact' : 'Save contact';
  const recent = field('recent-contacts');
  recent.replaceChildren();
  field('recent-contact-list').hidden = ![...recentPeers].some((key) => !contacts.includes(key));
  for (const key of new Set([...contacts, ...recentPeers])) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = authorLabel(key, key.slice(0, 10) + '…');
    button.setAttribute('aria-pressed', String(key === recipient));
    button.addEventListener('click', () => {
      if (key === field('recipient').value.trim()) return;
      field('recipient').value = key;
      recipientChanged();
      field('draft').focus();
    });
    (contacts.includes(key) ? list : recent).append(button);
  }
}

function recipientChanged() {
  field('draft').value = '';
  field('error').textContent = '';
  field('contact-status').textContent = '';
  updateChatActions();
  renderContacts();
  if (!selectedRoom) renderDirect();
}

field('toggle-contact').addEventListener('click', () => {
  const key = field('recipient').value.trim();
  if (!isPublicKey(key) || key === ownKey) return;
  const saved = contacts.includes(key);
  const next = saved ? contacts.filter((entry) => entry !== key) : [...contacts, key];
  try {
    localStorage.setItem(contactsSlot, JSON.stringify(next));
    contacts = next;
    renderContacts();
    field('contact-status').textContent = saved ? 'Contact removed.' : 'Contact saved.';
  } catch {
    field('contact-status').textContent = 'Could not update saved contacts.';
  }
});
let authenticated = false;
let sendingChat = false;
const seen = new Set();
const profileCacheSlot = 'patriothacks.check-ins.profile:' + ownKey;
let profiles = {};
try {
  const cached = parseChatProfile(JSON.parse(localStorage.getItem(profileCacheSlot) ?? 'null'));
  if (cached) profiles[ownKey] = cached;
} catch {}

function cacheOwnProfile() {
  try {
    if (profiles[ownKey]) localStorage.setItem(profileCacheSlot, JSON.stringify(profiles[ownKey]));
  } catch {}
}
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
  field('existing-profile').hidden = signedIn || !profile;
  field('profile-details').hidden = !signedIn && (!ready || !!profile);
  field('profile-title').hidden = !signedIn;
  if (!signedIn && ready && !profile) field('profile-details').open = true;
  field('sign-in-name').textContent = profile ? profileLabel(profile) : '';
  field('continue-chat').disabled = !profile;
  field('sign-in-wait').hidden = ready || !!profile;
  if (!signedIn) renderAccounts();
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
  if (profiles[ownKey]) enterChat(profiles[ownKey]);
});

// Cached profiles let the account list show names before the relay answers.
function cachedProfile(key) {
  try {
    return parseChatProfile(JSON.parse(localStorage.getItem('patriothacks.check-ins.profile:' + key) ?? 'null'));
  } catch {}
}

function renderAccounts() {
  const list = field('account-list');
  list.replaceChildren(...otherAccounts.map(({ secret, key }) => {
    const row = document.createElement('div');
    row.className = 'account-row';
    const button = document.createElement('button');
    button.type = 'button';
    const profile = profiles[key] ?? cachedProfile(key);
    const label = profile ? profileLabel(profile) : key.slice(0, 10) + '…';
    button.textContent = label;
    button.addEventListener('click', () => activateAccount(secret, true));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-account';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + label + ' from this browser');
    remove.addEventListener('click', () => removeAccount(secret, key));
    row.append(button, remove);
    return row;
  }));
}

// Removing deletes the key and this account's local data from the browser. Its relay profile is left as is.
function removeAccount(secret, key) {
  const profile = profiles[key] ?? cachedProfile(key);
  const name = profile?.name ?? 'this account';
  if (!window.confirm('Remove ' + name + ' from this browser? This deletes its key, contacts and check-ins here. It cannot be undone.')) return;
  const remaining = savedSecrets().filter((item) => item !== secret);
  try {
    localStorage.setItem(accountsSlot, JSON.stringify(remaining));
    for (const prefix of ['patriothacks.contacts.v1:', 'patriothacks.check-ins.outbox:', 'patriothacks.check-ins.received:', 'patriothacks.check-ins.profile:', 'patriothacks.daily-log:']) {
      localStorage.removeItem(prefix + key);
    }
    // With no accounts left, the next load creates a fresh identity.
    if (key === ownKey) {
      if (remaining.length) localStorage.setItem(identitySlot, remaining[0]);
      else localStorage.removeItem(identitySlot);
    }
  } catch {
    field('error').textContent = 'Browser storage is unavailable, so the account could not be removed.';
    return;
  }
  if (key === ownKey) {
    location.reload();
    return;
  }
  otherAccounts.splice(otherAccounts.findIndex((account) => account.key === key), 1);
  renderAccounts();
}

field('remove-account').addEventListener('click', () => removeAccount(base64(keys.secretKey), ownKey));

field('add-account').addEventListener('click', () => {
  const secret = base64(nacl.box.keyPair().secretKey);
  try {
    localStorage.setItem(accountsSlot, JSON.stringify([...savedSecrets(), secret]));
  } catch {
    field('error').textContent = 'Browser storage is unavailable, so a new account cannot be saved.';
    return;
  }
  activateAccount(secret, false);
});

// Signing out only returns to the sign-in screen. The browser keeps its identity,
// contacts and messages, and the relay connection stays open.
field('sign-out').addEventListener('click', () => {
  signedIn = false;
  selectTab(false);
  field('draft').value = '';
  field('error').textContent = '';
  field('profile-details').open = false;
  if (field('warning-dialog').open) field('warning-dialog').close();
  field('chat-sidebar').hidden = true;
  field('chat-workspace').hidden = true;
  document.body.classList.add('sign-in');
  updateSignIn();
});

function updateProfileSummary() {
  updateSignIn();
  renderContacts();
  field('profile-title').textContent = authorLabel(ownKey, 'Set up profile');
  if (selectedRoom) renderRoom();
  else renderDirect();
  if (reportOpen) renderReports();
  renderWarnings();
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
let incidents = {};

// Hazard warnings (air cutouts, bad water) for every level. Every signed-in resident sees all of them.
let warnings = [];
let warningBusy = false;
let renderedWarnings = '';
const warningTime = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function renderWarnings() {
  const homeLevel = profiles[ownKey]?.level;
  // The relay resends the snapshot every 30 s. Skip identical ones so screen readers don't repeat the banner.
  const signature = JSON.stringify([warnings, authenticated, warningBusy, homeLevel]);
  if (signature === renderedWarnings) return;
  renderedWarnings = signature;
  field('warning-banner').hidden = !warnings.length;
  field('warning-offline').hidden = authenticated;
  field('warning-items').replaceChildren(...warnings.map((warning) => {
    const mine = warning.reporters.includes(ownKey);
    const count = warning.reporters.length;
    const label = hazardLabels[warning.kind] ?? warning.kind;
    const item = document.createElement('article');
    item.className = 'warning-item warning-' + warning.kind;
    const title = document.createElement('strong');
    title.textContent = warning.level + ' · ' + label + (warning.level === homeLevel ? ' · your level' : '');
    const detail = document.createElement('div');
    detail.textContent = count + (count === 1 ? ' resident' : ' residents') + (mine ? ', including you' : '') +
      ' · latest ' + warningTime(warning.latestAt);
    item.append(title, detail);
    if (warning.note) {
      const note = document.createElement('div');
      note.className = 'warning-note';
      note.textContent = '“' + warning.note + '”';
      item.append(note);
    }
    // Confirm adds your report to someone else's warning; Clear mine withdraws only yours.
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = mine ? 'Clear mine' : 'Confirm';
    action.setAttribute('aria-label', (mine ? 'Clear your ' : 'Confirm the ') + label + ' warning for ' + warning.level);
    action.disabled = !authenticated || warningBusy;
    action.addEventListener('click', () => { void updateWarning(warning, mine); });
    item.append(action);
    return item;
  }));
}

async function updateWarning(warning, mine) {
  if (!authenticated || warningBusy) return;
  warningBusy = true;
  field('warning-error').textContent = '';
  renderWarnings();
  try {
    const ack = mine
      ? await socket.timeout(5000).emitWithAck(warningEvents.clear, warning.level, warning.kind)
      : await socket.timeout(5000).emitWithAck(warningEvents.raise, { level: warning.level, kind: warning.kind, note: '' });
    if (!ack.ok) throw new Error(ack.error);
  } catch (error) {
    field('warning-error').textContent = 'Warning not updated: ' + error.message;
  } finally {
    warningBusy = false;
    renderWarnings();
  }
}

// The Raise warning dialog: hazard, level (defaults to the one being viewed) and an optional location note.
field('warning-help').textContent = 'Every signed-in resident sees it, labelled with the level. It lasts ' +
  warningActiveMinutes + ' minutes unless you clear it or raise it again.';
for (const kind of hazardKinds) {
  const option = document.createElement('label');
  option.className = 'warning-kind';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'warning-kind';
  input.value = kind;
  input.required = true;
  option.append(input, hazardLabels[kind]);
  field('warning-kinds').append(option);
}
for (const room of rooms) field('warning-level').add(new Option(room, room));
field('warning-note').maxLength = warningNoteLimit;

field('raise-warning').addEventListener('click', () => {
  field('warning-form').reset();
  field('warning-level').value = selectedRoom || profiles[ownKey]?.level || rooms[0];
  field('warning-status').textContent = authenticated ? '' : 'Relay offline · Warnings need a connection to reach others.';
  field('warning-dialog').showModal();
});
field('warning-cancel').addEventListener('click', () => field('warning-dialog').close());
field('warning-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(field('warning-form'));
  const request = parseWarningRequest({ level: form.get('warning-level'), kind: form.get('warning-kind'), note: form.get('warning-note') });
  if (!request) {
    field('warning-status').textContent = 'Choose what’s happening, and keep the note to ' + warningNoteLimit + ' characters.';
    return;
  }
  if (!authenticated) {
    field('warning-status').textContent = 'Relay offline · Warnings need a connection to reach others.';
    return;
  }
  field('warning-send').disabled = true;
  field('warning-status').textContent = 'Sending…';
  try {
    const ack = await socket.timeout(5000).emitWithAck(warningEvents.raise, request);
    if (!ack.ok) throw new Error(ack.error);
    field('warning-dialog').close();
  } catch (error) {
    field('warning-status').textContent = error.message;
  } finally {
    field('warning-send').disabled = false;
  }
});

function renderIncident() {
  const banner = field('incident-banner');
  const active = incidents[selectedRoom] ?? [];
  banner.hidden = !active.length;
  const list = field('incident-items');
  list.replaceChildren();
  field('incident-offline').hidden = authenticated;
  for (const { issue, count, latestAt } of active) {
    const row = document.createElement('div');
    const time = new Date(latestAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    row.textContent = incidentLabels[issue] + ' · ' + count + ' reports in the past ' +
      incidentWindowMinutes + ' min · Latest ' + time;
    list.append(row);
  }
}
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

// selectTab(false) shows chat, selectTab(true) shows Stats, and selectTab(false, true) shows the daily log.
function selectTab(announcements, log = false) {
  reportOpen = announcements;
  reportRequest++;
  field('chat').hidden = announcements || log;
  field('report').hidden = !announcements;
  field('daily-log').hidden = !log;
  field('chat-tab').setAttribute('aria-pressed', String(!announcements && !log));
  field('announcements-tab').setAttribute('aria-pressed', String(announcements));
  field('log-tab').setAttribute('aria-pressed', String(log));
  if (log) renderDailyLog();
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
field('log-tab').addEventListener('click', () => selectTab(false, true));

// Daily log: a private record kept in this browser for the active account. It is never sent to the relay.
const dailyLogSlot = 'patriothacks.daily-log:' + ownKey;
const logSelects = new Map();
for (const { id, label, choices } of dailyLogQuestions) {
  const row = document.createElement('label');
  row.textContent = label;
  const select = document.createElement('select');
  select.add(new Option('Not answered', ''));
  for (const choice of choices) select.add(new Option(choice, choice));
  row.append(select);
  field('log-questions').append(row);
  logSelects.set(id, select);
}
field('log-notes').maxLength = dailyLogNotesLimit;

function readDailyLog() {
  try {
    const stored = JSON.parse(localStorage.getItem(dailyLogSlot) ?? '{}');
    return Object.values(stored ?? {}).map(parseDailyLogEntry).filter(Boolean)
      .sort((a, b) => b.day.localeCompare(a.day));
  } catch {
    return [];
  }
}

function renderDailyLog() {
  const today = dailyLogDay();
  const entries = readDailyLog();
  const saved = entries.find((entry) => entry.day === today);
  field('log-title').textContent = 'Daily log · ' + dailyLogDayLabel(today);
  for (const [id, select] of logSelects) select.value = saved?.answers[id] ?? '';
  field('log-notes').value = saved?.notes ?? '';
  field('log-status').textContent = '';
  const past = entries.filter((entry) => entry.day !== today).slice(0, 14);
  field('log-empty').hidden = past.length > 0;
  field('log-history').replaceChildren(...past.map((entry) => {
    const card = document.createElement('article');
    const heading = document.createElement('strong');
    heading.textContent = dailyLogDayLabel(entry.day);
    card.append(heading);
    for (const { id, label } of dailyLogQuestions) {
      if (!entry.answers[id]) continue;
      const line = document.createElement('span');
      line.textContent = label + ' · ' + entry.answers[id];
      card.append(line);
    }
    if (entry.notes) {
      const notes = document.createElement('span');
      notes.className = 'log-notes';
      notes.textContent = entry.notes;
      card.append(notes);
    }
    return card;
  }));
}

field('daily-log').addEventListener('submit', (event) => {
  event.preventDefault();
  const answers = {};
  for (const [id, select] of logSelects) if (select.value) answers[id] = select.value;
  const notes = field('log-notes').value.trim();
  if (!Object.keys(answers).length && !notes) {
    field('log-status').textContent = 'Answer at least one question or add a note.';
    return;
  }
  const day = dailyLogDay();
  try {
    const stored = JSON.parse(localStorage.getItem(dailyLogSlot) ?? '{}') ?? {};
    stored[day] = { day, answers, notes, savedAt: Date.now() };
    localStorage.setItem(dailyLogSlot, JSON.stringify(stored));
  } catch {
    field('log-status').textContent = 'Browser storage is unavailable, so the log could not be saved.';
    return;
  }
  renderDailyLog();
  field('log-status').textContent = 'Saved for ' + dailyLogDayLabel(day) + '.';
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

function showDirect(key, peer, text) {
  directMessages.push({ key, peer, text });
  if (!recentPeers.has(peer)) {
    recentPeers.add(peer);
    renderContacts();
  }
  if (!selectedRoom && field('recipient').value.trim() === peer) {
    show(authorLabel(key, key === ownKey ? 'You' : 'From ' + key.slice(0, 10) + '…'), text);
  }
}

function renderDirect() {
  field('messages').replaceChildren();
  const recipient = field('recipient').value.trim();
  for (const { key, peer, text } of directMessages) {
    if (peer !== recipient) continue;
    show(authorLabel(key, key === ownKey ? 'You' : 'From ' + key.slice(0, 10) + '…'), text);
  }
}

function selectChannel(channel) {
  if (channel === selectedRoom) return;
  selectedRoom = channel;
  renderIncident();
  field('level-tabs').hidden = !channel;
  selectTab(false);
  for (const [name, button] of channelButtons) {
    button.setAttribute('aria-pressed', String(name === channel));
  }
  field('channel-title').textContent = channel ? '# ' + channel : 'Direct chat';
  field('direct').hidden = !!selectedRoom;
  field('room-note').hidden = !selectedRoom;
  field('recipient').required = !selectedRoom;
  updateChatActions();
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

function updateChatActions() {
  renderCheckIn();
  field('send').disabled = !authenticated || sendingChat;
  const recipient = field('recipient').value.trim();
  field('sos').disabled = !authenticated || sendingChat ||
    (!selectedRoom && (!isPublicKey(recipient) || recipient === ownKey));
}

field('recipient').addEventListener('input', recipientChanged);
renderContacts();
updateSignIn();
// After switching to a saved account, open its chat right away if its profile is cached.
if (autoSignIn && profiles[ownKey]) enterChat(profiles[ownKey]);

function status(online, message) {
  authenticated = online;
  renderIncident();
  renderWarnings();
  field('status').textContent = message;
  updateChatActions();
  field('save-profile').disabled = !online || savingProfile;
  updateSignIn();
  field('report-fields').disabled = !online;
}

socket.on(incidentEvent, (snapshot) => {
  incidents = snapshot;
  renderIncident();
});
socket.on(warningEvents.snapshot, (snapshot) => {
  warnings = Array.isArray(snapshot) ? snapshot : [];
  renderWarnings();
});

socket.on(profileEvents.snapshot, (snapshot) => {
  profiles = snapshot;
  cacheOwnProfile();
  profilesReady = true;
  updateProfileSummary();
});
socket.on(profileEvents.changed, (key, profile) => {
  profiles[key] = profile;
  if (key === ownKey) cacheOwnProfile();
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
      void flushCheckIns();
      void loadRoom(selectedRoom);
      if (reportOpen) void updateReport({ hydrate: true });
    }
  } catch (error) {
    if (socket.id === connection) status(false, error.message);
  }
});

function show(label, text) {
  const line = document.createElement('li');
  if (text === sosMessage) line.className = 'sos-message';
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
      showDirect(message.from, message.from, body.text);
      rememberCheckIn(message, body.text);
      seen.add(deliveryId);
    }
    socket.emit(events.received, message.from, message.id);
  } catch {
    field('error').textContent = 'Could not read an incoming message.';
  }
});

function makeDirectEnvelope(to, text) {
  const id = crypto.randomUUID();
  const sentAt = Date.now();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = new TextEncoder().encode(JSON.stringify({ id, from: ownKey, to, sentAt, text }));
  const ciphertext = nacl.box(plaintext, nonce, bytes(to), keys.secretKey);
  return { v: 1, id, from: ownKey, to, sentAt, nonce: base64(nonce), ciphertext: base64(ciphertext) };
}

async function sendDirectEnvelope(message) {
  const ack = await socket.timeout(5000).emitWithAck(events.send, message);
  if (!ack.ok) throw new Error(ack.error);
}

setInterval(() => { void flushCheckIns(); }, 5000);

async function sendChat(sos = false) {
  if (!authenticated || sendingChat) return;
  field('error').textContent = '';
  const to = field('recipient').value.trim();
  const draft = field('draft');
  const text = sos ? sosMessage : draft.value.trim();
  const room = selectedRoom;
  if (!room && (!isPublicKey(to) || to === ownKey)) {
    field('error').textContent = 'Paste the other device’s public key.';
    return;
  }
  if (!text) return;
  sendingChat = true;
  updateChatActions();
  try {
    if (room) {
      const ack = await socket.timeout(5000).emitWithAck(roomEvents.send, room, text);
      if (!ack.ok) throw new Error(ack.error);
      if (!sos && selectedRoom === room && draft.value.trim() === text) draft.value = '';
      return;
    }
    await sendDirectEnvelope(makeDirectEnvelope(to, text));
    showDirect(ownKey, to, text);
    if (!sos && !selectedRoom && field('recipient').value.trim() === to && draft.value.trim() === text) draft.value = '';
  } catch (error) {
    field('error').textContent = error.message;
  } finally {
    sendingChat = false;
    updateChatActions();
  }
}

field('chat').addEventListener('submit', (event) => {
  event.preventDefault();
  void sendChat();
});
field('sos').addEventListener('click', () => {
  if (window.confirm('Post an in-app SOS to ' + (selectedRoom || 'this direct chat') + '?')) {
    void sendChat(true);
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
<title>Through The Earth</title>
<style>
/* Green terminal theme. Same palette as mobile/src/terminal-colors.json. */
:root{--bg:#03190b;--panel:#05240f;--field:#093317;--active:#0f5226;--line:#26a148;--muted:#3db35e;--dim:#4fd172;--text:#6bff8f;--glow:#c4ffd2;
--alert:#ff8a8a;--alert-bg:#3b0a12;--alert-line:#fb7185;--warn:#fef3c7;--warn-bg:#2e1f06;--warn-line:#d4a017}
*{box-sizing:border-box}
html{background:var(--bg)}
body{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh;margin:0;background:radial-gradient(ellipse at center,#062a12 0%,var(--bg) 75%);color:var(--text);
font:15px/1.45 Consolas,"Lucida Console","Courier New",monospace;text-shadow:0 0 4px rgba(107,255,143,.35);caret-color:var(--text)}
/* Faint scanlines over the whole screen. pointer-events:none keeps everything clickable. */
body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:10;background:repeating-linear-gradient(to bottom,transparent 0 2px,rgba(0,0,0,.22) 2px 3px)}
::selection{background:var(--text);color:var(--bg);text-shadow:none}
:focus-visible{outline:2px solid var(--glow);outline-offset:2px}
body.sign-in{grid-template-columns:minmax(0,1fr);place-items:center}
body.sign-in main{max-width:520px}
body.sign-in #profile-details{background:var(--panel);border:1px solid var(--line);border-radius:2px;padding:16px}
h1,h2,h3,h4,summary{color:var(--glow);text-transform:uppercase;letter-spacing:.12em;font-weight:700}
h2{font-size:1.15rem}h3{font-size:1rem}h4{font-size:.9rem}
h1{margin:0}p{color:var(--dim)}
#profile-details summary{cursor:pointer}
#profile-title[hidden]{display:none}
aside{background:var(--panel);border-right:1px solid var(--line);padding:20px 10px}
aside h1{font-size:.95rem;padding:0 8px 12px;border-bottom:1px solid var(--line);margin-bottom:12px}
aside h1::after{content:"_";animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
@media(prefers-reduced-motion:reduce){aside h1::after{animation:none}}
nav{display:grid;gap:4px}
nav button{background:transparent;border:1px solid transparent;color:var(--muted);text-align:left}
nav button:hover{border-color:var(--line);color:var(--text);background:var(--field)}
nav button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text);font-weight:700;text-shadow:none}
nav button[aria-pressed="true"]::before{content:"> "}
#sign-out{margin:16px 8px 0}
#other-accounts{background:var(--panel);border:1px solid var(--line);border-radius:2px;padding:16px;margin-top:16px}
#other-accounts h3{margin:0 0 10px}
#account-list{display:grid;gap:8px;margin-bottom:10px}
.account-row{display:flex;gap:8px}
.account-row button:first-child{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.remove-account,.remove-account:hover{background:transparent;border-color:transparent;color:var(--alert)}
#add-account,#add-account:hover{background:transparent;border-color:transparent;color:var(--glow);padding:6px 0;font-weight:700}
main{max-width:850px;width:100%;padding:24px}
@media(max-width:600px){body{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line)}nav{display:flex;flex-wrap:wrap}main{padding:16px}}
label{display:block;margin:16px 0 6px;color:var(--dim)}
input,textarea,button,select{font:inherit;padding:10px;border:1px solid var(--line);border-radius:2px}
input,textarea,select{background:var(--field);color:var(--text);width:100%}
input::placeholder,textarea::placeholder{color:var(--muted)}
option{background:var(--field);color:var(--text)}
button{background:var(--active);color:var(--text);border-color:var(--text);cursor:pointer;text-shadow:inherit}
button:hover:not(:disabled){background:var(--text);color:var(--bg);text-shadow:none}
button:disabled{opacity:.45;cursor:default}
.key{display:flex;gap:8px}
#saved-contacts,#recent-contacts{display:flex;flex-wrap:wrap;gap:8px}
#saved-contacts button,#recent-contacts button{background:var(--field);border-color:var(--line)}
#saved-contacts button[aria-pressed="true"],#recent-contacts button[aria-pressed="true"]{background:var(--text);color:var(--bg);text-shadow:none}
#toggle-contact{margin-top:8px}
#check-in{background:var(--panel);border:1px solid var(--line);border-radius:2px;padding:12px;margin-top:12px}
#check-in button{margin:4px 4px 0 0}
#check-in-pending{color:#ffd54f}
ul{min-height:120px;max-height:40vh;overflow:auto;padding:12px 12px 12px 32px;background:var(--panel);border:1px solid var(--line);border-radius:2px}
li{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:8px}
li::marker{color:var(--muted)}
#error{color:var(--alert)}
.status-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
#status{text-transform:uppercase;letter-spacing:.08em}
#local-clock{color:var(--glow);font-size:.875rem;font-variant-numeric:tabular-nums}
/* Alerts keep red and amber so they can't be mistaken for ordinary green text. */
#incident-banner{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn-line);border-radius:2px;padding:10px 12px;margin:12px 0;text-shadow:none}
#incident-banner strong{text-transform:uppercase;letter-spacing:.08em}
#incident-items,#incident-offline{font-size:.9rem;margin-top:4px}
#sos,#check-in-help,.sos-message{background:var(--alert-bg);color:#ffd6dc;border-color:var(--alert-line);text-shadow:0 0 4px rgba(251,113,133,.45)}
#sos:hover:not(:disabled),#check-in-help:hover:not(:disabled){background:var(--alert-line);color:var(--bg);text-shadow:none}
.sos-message{font-weight:700;border:1px solid var(--alert-line);border-radius:2px;padding:8px}
#level-tabs button{background:var(--field);border-color:var(--line);margin-right:6px}
#level-tabs button[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text);text-shadow:none}
#poll-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
#poll-charts article,#report-feed article,#log-history article{background:var(--panel);border:1px solid var(--line);border-radius:2px;padding:12px}
.pie-details{display:flex;align-items:center;gap:12px;margin-top:8px;font-size:.9rem}
.poll-pie{width:96px;height:96px;border-radius:50%;flex:none;border:1px solid var(--line)}
.pie-swatch{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
#report-feed{display:grid;gap:8px;margin:12px 0}
#report-feed article{display:grid;gap:5px}
#report-feed code{overflow-wrap:anywhere;color:var(--dim)}
#report-feed time{font-size:.85rem;color:var(--muted)}
#report-fields{border:0;margin:0;padding:0}
#report-questions,#log-questions{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px}
#report-questions select,#log-questions select{display:block;margin-top:5px}
#log-history{display:grid;gap:8px;margin:12px 0}
#log-history article{display:grid;gap:4px}
.log-notes{color:var(--dim);white-space:pre-wrap;overflow-wrap:anywhere}
/* Hazard warnings use the amber alert colors (air cutouts in rose), never the green theme. */
#raise-warning{display:block;margin:16px 8px 0;background:var(--warn-bg);color:var(--warn);border-color:var(--warn-line);text-shadow:none}
#raise-warning:hover:not(:disabled),#warning-send:hover:not(:disabled),.warning-item button:hover:not(:disabled){background:var(--warn-line);color:var(--bg);text-shadow:none}
#warning-banner{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn-line);border-radius:2px;padding:10px 12px;margin:0 0 16px;text-shadow:none}
#warning-banner h3{color:var(--warn);margin:0 0 8px}
#warning-banner p{color:var(--warn);font-size:.9rem;margin:0 0 6px}
#warning-banner p:empty{display:none}
#warning-items{display:grid;gap:12px;max-height:40vh;overflow:auto}
.warning-item{display:grid;gap:3px;justify-items:start}
.warning-item strong{text-transform:uppercase;letter-spacing:.08em}
.warning-air strong{color:#fecdd3}
.warning-item div{font-size:.9rem}
.warning-item button{margin-top:4px;padding:4px 10px;font-size:.85rem;background:transparent;color:var(--warn);border-color:var(--warn-line);text-shadow:none}
dialog{background:var(--panel);color:var(--text);border:1px solid var(--warn-line);border-radius:2px;padding:20px;width:min(480px,calc(100vw - 32px))}
dialog::backdrop{background:rgba(0,0,0,.75)}
#warning-title{color:var(--warn);margin-top:0}
#warning-kinds{display:flex;flex-wrap:wrap;gap:16px;border:1px solid var(--line);border-radius:2px;padding:8px 12px 12px;margin:16px 0 0}
#warning-kinds legend{color:var(--dim);padding:0 4px}
.warning-kind{display:inline-flex;align-items:center;gap:8px;margin:0;color:var(--text);cursor:pointer}
.warning-kind input{width:auto;padding:0;accent-color:var(--warn-line)}
.dialog-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
#warning-send{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-line)}
</style>
<body class="sign-in">
<aside id="chat-sidebar" hidden>
<h1>Through The Earth</h1>
<nav id="channels" aria-label="Channels"></nav>
<button type="button" id="raise-warning">⚠ Raise warning</button>
<button type="button" id="sign-out">Sign out</button>
</aside>
<main>
<section id="sign-in-card">
<h2>Sign in to Through The Earth</h2>
<p id="sign-in-wait">Waiting for your profile from the relay…</p>
<div id="existing-profile" hidden>
<p id="sign-in-name"></p>
<button type="button" id="continue-chat" disabled>Sign in</button>
<button type="button" id="remove-account" class="remove-account">Remove</button>
</div>
<section id="other-accounts">
<h3>Sign in to another account</h3>
<div id="account-list"></div>
<button type="button" id="add-account">+ Add another account</button>
</section>
</section>
<div class="status-row">
<p id="status" role="status">Connecting to relay…</p>
<div id="local-clock" role="timer" aria-label="Local time"></div>
</div>
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
<section id="warning-banner" aria-labelledby="warning-banner-title" aria-live="polite" hidden>
<h3 id="warning-banner-title">⚠ Active warnings</h3>
<p id="warning-offline" hidden>Relay offline · Showing last received warnings</p>
<div id="warning-items"></div>
<p id="warning-error" role="alert"></p>
</section>
<h2 id="channel-title">Direct chat</h2>
<label for="public-key">Your public key</label>
<div class="key"><input id="public-key" readonly><button id="copy" type="button">Copy</button></div>
<p id="identity-note">This browser profile keeps your chat identity on this PC.</p>
<div id="level-tabs" hidden>
<button type="button" id="chat-tab" aria-pressed="true">Chat</button>
<button type="button" id="announcements-tab" aria-pressed="false">Stats</button>
<button type="button" id="log-tab" aria-pressed="false">Daily log</button>
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
<form id="daily-log" hidden>
<h3 id="log-title">Daily log</h3>
<p>Only you can see this. It is saved in this browser and is never sent to the relay.</p>
<div id="log-questions"></div>
<label for="log-notes">Notes (optional)</label>
<textarea id="log-notes" rows="3" placeholder="What you ate, symptoms, anything else"></textarea>
<p id="log-status" role="status"></p>
<button type="submit">Save today</button>
<h4>Past days</h4>
<p id="log-empty">No earlier entries yet.</p>
<div id="log-history"></div>
</form>
<form id="chat">
<section id="incident-banner" role="status" hidden>
<strong>Early warning · Resident reports</strong>
<div id="incident-offline" hidden>Relay offline · Showing last received warning</div>
<div id="incident-items"></div>
</section>
<p id="room-note" hidden>Open demo room · Messages are visible to the relay.</p>
<div id="direct">
<section id="contact-list" hidden>
<h3>Saved contacts</h3>
<div id="saved-contacts"></div>
</section>
<section id="recent-contact-list" hidden>
<h3>Recent chats</h3>
<div id="recent-contacts"></div>
</section>
<label for="recipient">Recipient public key</label>
<input id="recipient" spellcheck="false" autocomplete="off" required>
<button type="button" id="toggle-contact" hidden>Save contact</button>
<p id="contact-status" role="status"></p>
<section id="check-in" aria-label="Contact check-in" hidden>
<div id="check-in-latest" role="status"></div>
<div id="check-in-pending" role="status"></div>
<button type="button" id="check-in-okay">I’m okay</button>
<button type="button" id="check-in-request">Request a check-in</button>
<button type="button" id="check-in-help">I need help</button>
</section>
</div>
<ul id="messages" aria-label="Messages" aria-live="polite"></ul>
<label for="draft">Message</label>
<textarea id="draft" rows="3" maxlength="2000" required></textarea>
<p id="error" role="alert"></p>
<button id="send" disabled>Send</button>
<button type="button" id="sos" disabled>Send SOS</button>
</form>
</div>
<dialog id="warning-dialog" aria-labelledby="warning-title">
<form id="warning-form">
<h2 id="warning-title">⚠ Raise a warning</h2>
<p id="warning-help"></p>
<fieldset id="warning-kinds"><legend>What’s happening?</legend></fieldset>
<label for="warning-level">Which level?</label>
<select id="warning-level" name="warning-level"></select>
<label for="warning-note">Where? (optional)</label>
<input id="warning-note" name="warning-note" placeholder="e.g. east pump room" autocomplete="off">
<p id="warning-status" role="status"></p>
<div class="dialog-actions">
<button type="submit" id="warning-send">Send warning</button>
<button type="button" id="warning-cancel">Cancel</button>
</div>
</form>
</dialog>
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
