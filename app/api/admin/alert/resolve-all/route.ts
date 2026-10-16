import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const result = await prisma.alert.updateMany({
      where: { resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        resolvedBy: auth.name,
        resolution: 'bulk',
      },
    });

    return NextResponse.json({
      success: true,
      count: result.count,
    });
  } catch (error: any) {
    console.error('Bulk resolve error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}