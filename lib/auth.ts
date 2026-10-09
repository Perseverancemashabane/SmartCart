import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';

// ============================================================
// Config
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'smartcart-dev-secret-change-in-production';
const secretKey = new TextEncoder().encode(JWT_SECRET);
const SESSION_DURATION_DAYS = 30;
export const SESSION_COOKIE_NAME = 'smartcart_session';

// ============================================================
// PIN hashing
// ============================================================
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

// ============================================================
// JWT session
// ============================================================
export interface SessionPayload {
  customerId: number;
  phoneNumber: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(secretKey);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (typeof payload.customerId !== 'number' || typeof payload.phoneNumber !== 'string') {
      return null;
    }
    return {
      customerId: payload.customerId,
      phoneNumber: payload.phoneNumber,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Cookie helpers
// ============================================================
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
  };
}

// ============================================================
// Read session from incoming request
// ============================================================
export async function getSessionFromCookies(
  cookieHeader: string | null
): Promise<SessionPayload | null> {
  if (!cookieHeader) return null;
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySession(token);
}

// ============================================================
// Phone normalization
// ============================================================
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, '');
}

// ============================================================
// ⭐ NEW: Verify PIN by customerId (for checkout / kiosk)
// Does NOT create a session — just checks the PIN is correct.
// ============================================================
export async function verifyPinById(
  customerId: number,
  pin: string
): Promise<{ valid: boolean; reason?: string }> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { pinHash: true, lockedUntil: true },
  });

  if (!customer || !customer.pinHash) {
    return { valid: false, reason: 'Customer not found or has no PIN' };
  }

  if (customer.lockedUntil && customer.lockedUntil > new Date()) {
    return { valid: false, reason: 'Account is temporarily locked' };
  }

  const valid = await verifyPin(pin, customer.pinHash);
  return { valid };
}