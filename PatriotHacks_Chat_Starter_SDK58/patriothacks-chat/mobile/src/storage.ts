import { openDatabaseAsync } from 'expo-sqlite';
import type { Envelope } from '@patriot/protocol';

async function openHistory() {
  const db = await openDatabaseAsync('patriot-chat.db');
  await db.execAsync('CREATE TABLE IF NOT EXISTS messages (sender TEXT, id TEXT, recipient TEXT, created INTEGER, envelope TEXT NOT NULL, PRIMARY KEY (sender, id))');
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
