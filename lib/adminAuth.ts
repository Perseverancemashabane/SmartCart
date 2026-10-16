import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPin } from '@/lib/auth';

export interface AdminSession {
  staffId: number;
  name: string;
}

/**
 * Admin auth via direct PIN validation on every request.
 *
 * The admin page stores the staff PIN in sessionStorage and sends it
 * in the x-admin-pin header with every admin API call. The backend
 * validates against the Staff table each time.
 *
 * This is stateless, works on serverless, and requires no new tables.
 */

const pinCache = new Map<string, { staffId: number; name: string; cachedAt: number }>();
const PIN_CACHE_MS = 60 * 1000; // cache for 1 minute to avoid re-hashing on rapid calls

export async function requireAdmin(
  request: Request
): Promise<AdminSession | NextResponse> {
  const pin = request.headers.get('x-admin-pin');

  if (!pin || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json(
      { error: 'Not authenticated as admin' },
      { status: 401 }
    );
  }

  // Check short-lived cache
  const cached = pinCache.get(pin);
  if (cached && Date.now() - cached.cachedAt < PIN_CACHE_MS) {
    return { staffId: cached.staffId, name: cached.name };
  }

  // Validate against DB
  const staffList = await prisma.staff.findMany({
    where: { isActive: true },
    select: { id: true, name: true, pinHash: true },
  });

  for (const staff of staffList) {
    const valid = await verifyPin(pin, staff.pinHash);
    if (valid) {
      pinCache.set(pin, {
        staffId: staff.id,
        name: staff.name,
        cachedAt: Date.now(),
      });
      return { staffId: staff.id, name: staff.name };
    }
  }

  return NextResponse.json(
    { error: 'Invalid staff PIN' },
    { status: 401 }
  );
}