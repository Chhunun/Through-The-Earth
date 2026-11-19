import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import type { Challenge, Envelope } from '@patriot/protocol';

nacl.setPRNG((buffer, length) => buffer.set(Crypto.getRandomValues(new Uint8Array(length))));

type Identity = { publicKey: string; secretKey: Uint8Array };
let identity: Promise<Identity> | undefined;

// The active account's secret key. Older builds only had this slot, so it stays the source of truth.
const activeSlot = 'patriothacks.box.v1';
// Every account saved on this device, as base64 secret keys in the order they were added.
const accountsSlot = 'patriothacks.accounts.v1';

async function savedSecrets(): Promise<string[]> {
  try {
    const list = JSON.parse((await SecureStore.getItemAsync(accountsSlot)) ?? '[]');
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

const publicKeyOf = (secret: string) =>
  util.encodeBase64(nacl.box.keyPair.fromSecretKey(util.decodeBase64(secret)).publicKey);

async function loadIdentity(): Promise<Identity> {
  const saved = await SecureStore.getItemAsync(activeSlot);
  const pair = saved
    ? nacl.box.keyPair.fromSecretKey(util.decodeBase64(saved))
    : nacl.box.keyPair();
  const secret = saved ?? util.encodeBase64(pair.secretKey);

  if (!saved) await SecureStore.setItemAsync(activeSlot, secret);
  const secrets = await savedSecrets();
  if (!secrets.includes(secret)) await SecureStore.setItemAsync(accountsSlot, JSON.stringify([...secrets, secret]));
  return { publicKey: util.encodeBase64(pair.publicKey), secretKey: pair.secretKey };
}

// Public keys of every account on this device, including the active one.
export async function accountKeys() {
  await getIdentity();
  return (await savedSecrets()).map(publicKeyOf);
}

// Close the relay session before calling these. Anything still using the old key afterwards would fail.
async function activate(secret: string) {
  await SecureStore.setItemAsync(activeSlot, secret);
  identity = undefined;
}

export async function switchAccount(key: string) {
  const secret = (await savedSecrets()).find((item) => publicKeyOf(item) === key);
  if (!secret) throw new Error('That account is not saved on this device');
  await activate(secret);
}

// Forget an account's key. Removing the active account activates the next saved one,
// or a brand-new account if it was the last. Returns the public keys that remain.
export async function removeAccount(key: string) {
  const remaining = (await savedSecrets()).filter((secret) => publicKeyOf(secret) !== key);
  if (!remaining.length) remaining.push(util.encodeBase64(nacl.box.keyPair().secretKey));
  await SecureStore.setItemAsync(accountsSlot, JSON.stringify(remaining));
  if ((await publicKey()) === key) await activate(remaining[0]);
  return remaining.map(publicKeyOf);
}

export async function addAccount() {
  const secret = util.encodeBase64(nacl.box.keyPair().secretKey);
  await SecureStore.setItemAsync(accountsSlot, JSON.stringify([...await savedSecrets(), secret]));
  await activate(secret);
}

function getIdentity() {
  identity ??= loadIdentity().catch((error) => {
    identity = undefined;
    throw error;
  });
  return identity;
}

export async function publicKey() {
  return (await getIdentity()).publicKey;
}

export async function proveIdentity(challenge: Challenge) {
  const { secretKey } = await getIdentity();
  const proof = nacl.box.open(
    util.decodeBase64(challenge.ciphertext), util.decodeBase64(challenge.nonce),
    util.decodeBase64(challenge.publicKey), secretKey,
  );
  if (!proof || proof.length !== 32) throw new Error('Invalid relay challenge');
  return util.encodeBase64(proof);
}

export async function encryptMessage(to: string, text: string): Promise<Envelope> {
  const { publicKey: from, secretKey } = await getIdentity();
  const id = Crypto.randomUUID();
  const sentAt = Date.now();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const body = util.decodeUTF8(JSON.stringify({ id, from, to, sentAt, text }));
  const ciphertext = nacl.box(body, nonce, util.decodeBase64(to), secretKey);
  return { v: 1, id, from, to, sentAt, nonce: util.encodeBase64(nonce), ciphertext: util.encodeBase64(ciphertext) };
}

export async function decryptMessage(message: Envelope): Promise<string> {
  const { publicKey: ownKey, secretKey } = await getIdentity();
  if (message.from !== ownKey && message.to !== ownKey) throw new Error('Message belongs to another device');
  const peer = message.from === ownKey ? message.to : message.from;
  const plaintext = nacl.box.open(
    util.decodeBase64(message.ciphertext), util.decodeBase64(message.nonce),
    util.decodeBase64(peer), secretKey,
  );
  if (!plaintext) throw new Error('Message authentication failed');
  const body = JSON.parse(util.encodeUTF8(plaintext));
  if (body.id !== message.id || body.from !== message.from || body.to !== message.to
    || body.sentAt !== message.sentAt || typeof body.text !== 'string') {
    throw new Error('Message metadata mismatch');
  }
  return body.text;
}
