import crypto from 'node:crypto';

const algorithm = { name: 'HMAC', hash: 'SHA-256' };

const getCryptoKey = async (secret: string | BufferSource): Promise<CryptoKey> => {
  const secretBuf = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
  return await crypto.subtle.importKey('raw', secretBuf, algorithm, false, ['sign', 'verify']);
};

export const safeCompare = (a: string, b: string): boolean => {
  return a.length === b.length && crypto.timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
};

export const makeSignature = async (value: string, secret: string | BufferSource): Promise<string> => {
  const key = await getCryptoKey(secret);
  const signature = await crypto.subtle.sign(algorithm.name, key, new TextEncoder().encode(value));
  // the returned base64 encoded signature will always be 44 characters long and end with one or two equal signs
  return btoa(String.fromCodePoint(...new Uint8Array(signature)));
};
