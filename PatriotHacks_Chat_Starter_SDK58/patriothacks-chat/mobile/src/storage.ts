import { openDatabaseAsync } from 'expo-sqlite';
import type { Envelope } from '@patriot/protocol';

async function openHistory() {
  const db = await openDatabaseAsync('patriot-chat.db');
  await db.execAsync('CREATE TABLE IF NOT EXISTS messages (sender TEXT, id TEXT, recipient TEXT, created INTEGER, envelope TEXT NOT NULL, PRIMARY KEY (sender, id))');
  await db.execAsync('CREATE TABLE IF NOT EXISTS contacts (owner TEXT NOT NULL, peer TEXT NOT NULL, PRIMARY KEY (owner, peer))');
  await db.execAsync('CREATE TABLE IF NOT EXISTS check_in_outbox (owner TEXT NOT NULL, id TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY (owner, id))');
  return db;
}

let database: ReturnType<typeof openHistory> | undefined;
function getDatabase() {
  database ??= openHistory().catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

export async function save(message: Envelope) {
  const db = await getDatabase();
  await db.runAsync('INSERT OR IGNORE INTO messages VALUES (?, ?, ?, ?, ?)',
    message.from, message.id, message.to, message.sentAt, JSON.stringify(message));
}

export async function history(key: string): Promise<Envelope[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ envelope: string }>(
    'SELECT envelope FROM messages WHERE sender = ? OR recipient = ? ORDER BY created, id',
    key, key,
  );
  return rows.map((row) => JSON.parse(row.envelope));
}

export async function savedContacts(owner: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ peer: string }>(
    'SELECT peer FROM contacts WHERE owner = ? ORDER BY rowid', owner,
  );
  return rows.map(({ peer }) => peer);
}

export async function storeContact(owner: string, peer: string, saved: boolean) {
  const db = await getDatabase();
  if (saved) {
    await db.runAsync('INSERT OR IGNORE INTO contacts (owner, peer) VALUES (?, ?)', owner, peer);
  } else {
    await db.runAsync('DELETE FROM contacts WHERE owner = ? AND peer = ?', owner, peer);
  }
}

export async function queuedCheckIns(owner: string): Promise<Envelope[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ envelope: string }>(
    'SELECT envelope FROM check_in_outbox WHERE owner = ? ORDER BY rowid', owner,
  );
  return rows.map(({ envelope }) => JSON.parse(envelope));
}

export async function queueCheckIn(envelope: Envelope) {
  const db = await getDatabase();
  await db.runAsync('INSERT INTO check_in_outbox (owner, id, envelope) VALUES (?, ?, ?)',
    envelope.from, envelope.id, JSON.stringify(envelope));
}

export async function removeCheckIn(envelope: Envelope) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM check_in_outbox WHERE owner = ? AND id = ?', envelope.from, envelope.id);
}
