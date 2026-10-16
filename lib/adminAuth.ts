import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export interface AdminSession {
  staffId: number;
  name: string;
}

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// ============================================================
//  Generate a new admin token and store it in the DB
// ============================================================
export async function generateAdminToken(
  staffId: number,
  name: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.adminSession.create({
    data: {
      token,
      staffId,
      staffName: name,
      expiresAt,
    },
  });

  // Opportunistic cleanup: delete expired tokens occasionally
  try {
    await prisma.adminSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  } catch (e) {
    // Not critical
  }

  return token;
}

// ============================================================
//  Validate a token from the request
// ============================================================
export async function validateAdminToken(
  token: string | null
): Promise<AdminSession | null> {
  if (!token) return null;

  const row = await prisma.adminSession.findUnique({
    where: { token },
  });

  if (!row) return null;
  if (row.expiresAt < new Date()) {
    // Expired — clean it up
    try {
      await prisma.adminSession.delete({ where: { id: row.id } });
    } catch (e) {}
    return null;
  }

  // Update lastUsedAt opportunistically (non-blocking)
  prisma.adminSession
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    staffId: row.staffId,
    name: row.staffName,
  };
}

// ============================================================
//  Middleware-style helper
// ============================================================
export async function requireAdmin(
  request: Request
): Promise<AdminSession | NextResponse> {
  const authHeader = request.headers.get('x-admin-token');
  const session = await validateAdminToken(authHeader);
  if (!session) {
    return NextResponse.json(
      { error: 'Not authenticated as admin' },
      { status: 401 }
    );
  }
  return session;
}