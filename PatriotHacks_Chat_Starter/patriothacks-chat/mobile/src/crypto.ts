import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import type { Challenge, Envelope } from '@patriot/protocol';

nacl.setPRNG((buffer, length) => buffer.set(Crypto.getRandomValues(new Uint8Array(length))));

type Identity = { publicKey: string; secretKey: Uint8Array };
let identity: Promise<Identity> | undefined;

async function loadIdentity(): Promise<Identity> {
  const slot = 'patriothacks.box.v1';
  const saved = await SecureStore.getItemAsync(slot);
  const pair = saved
    ? nacl.box.keyPair.fromSecretKey(util.decodeBase64(saved))
    : nacl.box.keyPair();

  if (!saved) await SecureStore.setItemAsync(slot, util.encodeBase64(pair.secretKey));
  return { publicKey: util.encodeBase64(pair.publicKey), secretKey: pair.secretKey };
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
