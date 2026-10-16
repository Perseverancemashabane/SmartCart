import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

/**
 * POST /api/admin/alert/resolve-all
 *
 * Marks ALL unresolved alerts as resolved with resolution='bulk'.
 * Does NOT touch cart sessions — just clears the admin dashboard.
 */
export async function POST(request: Request) {
  try {
    const auth = requireAdmin(request);
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