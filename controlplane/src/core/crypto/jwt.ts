import { hkdf, randomFill, randomUUID, subtle } from 'node:crypto';
import { decodeJwt, EncryptJWT, jwtDecrypt, JWTPayload, jwtVerify, KeyLike, SignJWT } from 'jose';
import { JWTDecodeParams, JWTEncodeParams } from '../../types/index.js';
import { base64URLEncode } from '../util.js';

export const nowInSeconds = () => Math.trunc(Date.now() / 1000);
export const DEFAULT_SESSION_MAX_AGE_SEC = 24 * 60 * 60; // 1 day

// The cookie name used to store the user session.
export const userSessionCookieName = 'cosmo_user_session';
// The cookie name used to store the PKCE code verifier.
export const pkceCodeVerifierCookieName = 'cosmo_pkce_code_verifier';
// The cookie name used to store theligin idp hint
export const cosmoIdpHintCookieName = 'cosmo_idp_hint';

/**
 * Generate random `code_verifier` value.
 *
 * @see [RFC 7636 - Proof Key for Code Exchange by OAuth Public Clients (PKCE)](https://www.rfc-editor.org/rfc/rfc7636.html#section-4)
 */
export function generateRandomCodeVerifier(): Promise<string> {
  const buf = Buffer.alloc(32);

  return new Promise((resolve, reject) => {
    randomFill(buf, (err, buf) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(base64URLEncode(buf));
    });
  });
}

/**
 * Calculates the PKCE `code_verifier` value to send with an authorization request using the S256
 * PKCE Code Challenge Method transformation.
 *
 * @see [RFC 7636 - Proof Key for Code Exchange by OAuth Public Clients (PKCE)](https://www.rfc-editor.org/rfc/rfc7636.html#section-4)
 */
export async function calculatePKCECodeChallenge(codeVerifier: string) {
  const buf = await subtle.digest({ name: 'SHA-256' }, Buffer.from(codeVerifier));
  return base64URLEncode(Buffer.from(buf));
}

/**
 * Encrypt a JWT token.
 *
 * @param params
 */
export async function encrypt<Payload extends JWTPayload = JWTPayload>(params: JWTEncodeParams<Payload>) {
  const { token = {}, secret, maxAgeInSeconds = DEFAULT_SESSION_MAX_AGE_SEC } = params;
  const encryptionSecret = await getDerivedEncryptionKey(secret);
  return await new EncryptJWT(token)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(nowInSeconds() + maxAgeInSeconds)
    .setJti(randomUUID())
    .encrypt(encryptionSecret);
}

/**
 * Decrypt a JWT token.
 *
 * @param params
 */
export async function decrypt<Payload = JWTPayload>(params: JWTDecodeParams): Promise<Payload> {
  const { token, secret } = params;
  if (!token) {
    throw new Error('No token provided');
  }
  const encryptionSecret = await getDerivedEncryptionKey(secret);
  const { payload } = await jwtDecrypt(token, encryptionSecret, {
    clockTolerance: 15,
  });
  return payload as Payload;
}

/**
 * Decode a JWT token without verifying the signature.
 *
 * @param token
 */
export function decodeJWT<Payload extends JWTPayload = JWTPayload>(token: string) {
  return decodeJwt(token) as Payload & JWTPayload;
}

/**
 * Derive an encryption key from a secret.
 *
 * @param secret
 */
export function getDerivedEncryptionKey(secret: string | Buffer) {
  return new Promise<Uint8Array>((resolve, reject) => {
    hkdf('sha256', secret, '', 'WunderGraph Cosmo Generated Encryption Key', 32, (err, derivedEncryptionKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(new Uint8Array(derivedEncryptionKey));
    });
  });
}

export async function signJwtHS256<Payload extends JWTPayload = JWTPayload>(params: JWTEncodeParams<Payload>) {
  const secret = new TextEncoder().encode(params.secret);
  return await new SignJWT(params.token).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().sign(secret);
}

export async function verifyJwt<Payload extends JWTPayload = JWTPayload>(secret: string, jwt: string) {
  const result = await jwtVerify(jwt, new TextEncoder().encode(secret));
  return result.payload as Payload;
}
