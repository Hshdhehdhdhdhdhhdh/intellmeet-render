import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  encodedHash: string
): Promise<boolean> {
  if (!/^\$2[aby]\$\d{2}\$/.test(encodedHash)) return false;
  try {
    return await bcrypt.compare(password, encodedHash);
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
