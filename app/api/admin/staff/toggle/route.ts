import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { staffId, isActive } = body;

    if (typeof staffId !== 'number' || typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'staffId and isActive required' },
        { status: 400 }
      );
    }

    const staff = await prisma.staff.update({
      where: { id: staffId },
      data: { isActive },
    });

    return NextResponse.json({
      success: true,
      staff: { id: staff.id, name: staff.name, isActive: staff.isActive },
    });
  } catch (error: any) {
    console.error('Staff toggle error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}