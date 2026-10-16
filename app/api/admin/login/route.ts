import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPin } from '@/lib/auth';
import { generateAdminToken } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { pin } = body;

    if (!pin || typeof pin !== 'string') {
      return NextResponse.json({ error: 'pin is required' }, { status: 400 });
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be 4 to 6 digits' },
        { status: 400 }
      );
    }

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

    for (const staff of staffList) {
      const valid = await verifyPin(pin, staff.pinHash);
      if (valid) {
        const token = generateAdminToken(staff.id, staff.name);
        return NextResponse.json({
          success: true,
          token,
          staff: { id: staff.id, name: staff.name },
          expiresInSeconds: 7200,
        });
      }
    }

    return NextResponse.json({ error: 'Invalid staff PIN' }, { status: 401 });
  } catch (error: any) {
    console.error('Admin login error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}