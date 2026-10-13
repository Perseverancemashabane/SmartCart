import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPin } from '@/lib/auth';

/**
 * POST /api/auth/staff-verify
 *
 * Body: { "pin": "9999" }
 *
 * Verifies a staff PIN against the Staff table.
 * Returns { valid: true/false }.
 *
 * No session required — the cart calls this when a staff member
 * needs to silence an anti-theft alarm or clear an abandoned cart.
 *
 * If multiple active staff exist, ANY of their PINs will validate.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { pin } = body;

    if (!pin || typeof pin !== 'string') {
      return NextResponse.json(
        { error: 'pin is required' },
        { status: 400 }
      );
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be 4 to 6 digits' },
        { status: 400 }
      );
    }

    // Fetch all active staff and try the PIN against each
    const staffList = await prisma.staff.findMany({
      where: { isActive: true },
      select: { id: true, name: true, pinHash: true },
    });

    if (staffList.length === 0) {
      return NextResponse.json(
        { error: 'No active staff configured' },
        { status: 500 }
      );
    }

    // Try the PIN against each staff member
    for (const staff of staffList) {
      const valid = await verifyPin(pin, staff.pinHash);
      if (valid) {
        return NextResponse.json({
          valid: true,
          staff: {
            id: staff.id,
            name: staff.name,
          },
        });
      }
    }

    // No staff matched
    return NextResponse.json(
      { valid: false, error: 'Invalid staff PIN' },
      { status: 401 }
    );
  } catch (error: any) {
    console.error('Staff verify error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}