import argon2 from "argon2";

/**
 * Argon2id per docs/PRODUCT_SPEC.md section 3 ("Use Argon2id where
 * password hashing is your responsibility"). Parameters follow OWASP's
 * current baseline recommendation for interactive login.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
