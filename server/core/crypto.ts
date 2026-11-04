import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** scrypt, self-describing format: scrypt$N$r$p$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const N = config().PASSWORD_SCRYPT_N, r = 8, p = 1;
  const salt = randomBytes(16);
  const dk = await scrypt(password.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do comparable work so unknown users / users without a password are not distinguishable by timing.
  const dummy = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const parts = (stored ?? dummy).split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const dk = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
  return stored != null && dk.length === expected.length && timingSafeEqual(dk, expected);
}

const COMMON = new Set(['password1234', 'passwordpassword', '123456789012', 'qwertyuiopas', 'letmein12345', 'plumeo123456', 'welcome12345']);
export function passwordProblem(pw: string, minLength = 12): string | null {
  if (pw.length < minLength) return `Password must be at least ${minLength} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return 'That password is too easy to guess.';
  if (new Set(pw).size < 5) return 'Use a more varied password.';
  return null;
}

/** AES-256-GCM for secrets at rest. Format: v1.iv.tag.ciphertext (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', config().encKey!, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}
export function decryptSecret(blob: string): string {
  const [v, iv, tag, enc] = blob.split('.');
  if (v !== 'v1') throw new Error('unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', config().encKey!, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
