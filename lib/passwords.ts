import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// 12 characters without look-alikes (0/O, 1/l/I).
export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) password += alphabet[crypto.randomInt(alphabet.length)];
  return password;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
