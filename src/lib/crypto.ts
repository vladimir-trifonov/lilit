/**
 * AES-256-GCM encryption for sensitive values (OAuth tokens).
 * When TOKEN_ENCRYPTION_KEY env var is not set, operates in passthrough mode.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const ENCRYPTED_PREFIX = "enc:";

function getKey(): Buffer | null {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) return null;
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  return buf;
}

/** Encrypt a plaintext string. Returns prefixed ciphertext or plaintext if no key. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: enc:<iv>:<tag>:<ciphertext> (all base64)
  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/** Decrypt a value. Handles both encrypted (prefixed) and legacy plaintext values. */
export function decrypt(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;

  const key = getKey();
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY required to decrypt tokens");
  }

  const parts = value.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted value");

  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}
