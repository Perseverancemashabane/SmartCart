import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPin } from '@/lib/auth';
import { requireAdmin } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { name, pin } = body;

    if (!name || !pin) {
      return NextResponse.json({ error: 'name and pin required' }, { status: 400 });
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be 4 to 6 digits' },
        { status: 400 }
      );
    }

    const pinHash = await hashPin(pin);

    const staff = await prisma.staff.create({
      data: { name: name.trim(), pinHash, isActive: true },
    });

    return NextResponse.json({
      success: true,
      staff: { id: staff.id, name: staff.name, isActive: staff.isActive },
    });
  } catch (error: any) {
    console.error('Staff add error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}