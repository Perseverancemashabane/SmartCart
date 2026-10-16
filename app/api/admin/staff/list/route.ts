import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const staff = await prisma.staff.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      staff: staff.map(s => ({
        id: s.id,
        name: s.name,
        isActive: s.isActive,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error('Staff list error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}