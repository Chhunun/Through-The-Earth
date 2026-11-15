export const events = {
  challenge: 'identity:challenge',
  authenticate: 'identity:authenticate',
  send: 'message:send',
  receive: 'message:receive',
  received: 'message:received',
} as const;

export interface Envelope {
  v: 1;
  id: string;
  from: string;
  to: string;
  nonce: string;
  ciphertext: string;
  sentAt: number;
}

export interface Challenge {
  publicKey: string;
  nonce: string;
  ciphertext: string;
}

export type Ack = { ok: true } | { ok: false; error: string };

export const isPublicKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(value);

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<Envelope>;
  return e.v === 1 && typeof e.id === 'string' && /^[0-9a-f-]{36}$/.test(e.id)
    && isPublicKey(e.from) && isPublicKey(e.to) && e.from !== e.to
    && typeof e.nonce === 'string' && /^[A-Za-z0-9+/]{32}$/.test(e.nonce)
    && typeof e.ciphertext === 'string' && e.ciphertext.length >= 24
    && e.ciphertext.length <= 32_768 && e.ciphertext.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext)
    && typeof e.sentAt === 'number' && Number.isSafeInteger(e.sentAt) && e.sentAt > 0;
}
