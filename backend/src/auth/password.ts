import argon2 from "argon2";

// argon2id with the library defaults (64 MiB, 3 iterations), above the OWASP minimum.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// Verified against when the email is unknown, so login takes about the same time
// whether or not the account exists.
const dummyHash = hashPassword("timing-equalization-only");

export async function verifyDummyPassword(password: string): Promise<void> {
  await argon2.verify(await dummyHash, password);
}
