import { NextResponse } from 'next/server';
import crypto from 'crypto';

export interface AdminSession {
  staffId: number;
  name: string;
  expiresAt: number;
}

export const adminTokens = new Map<string, AdminSession>();

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function generateAdminToken(staffId: number, name: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, {
    staffId,
    name,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

export function validateAdminToken(token: string | null): AdminSession | null {
  if (!token) return null;
  const session = adminTokens.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    adminTokens.delete(token);
    return null;
  }
  return session;
}

export function requireAdmin(request: Request): AdminSession | NextResponse {
  const authHeader = request.headers.get('x-admin-token');
  const session = validateAdminToken(authHeader);
  if (!session) {
    return NextResponse.json(
      { error: 'Not authenticated as admin' },
      { status: 401 }
    );
  }
  return session;
}