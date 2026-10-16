import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

/**
 * POST /api/admin/tag/remove
 * Body: { tagId }
 */
export async function POST(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { tagId } = body;

    if (!tagId) {
      return NextResponse.json({ error: 'tagId is required' }, { status: 400 });
    }

    // Soft-delete: mark inactive rather than hard delete
    const updated = await prisma.productTag.update({
      where: { id: tagId },
      data: { isActive: false },
    });

    return NextResponse.json({
      success: true,
      tagId: updated.id,
      rfidTagId: updated.rfidTagId,
    });
  } catch (error: any) {
    console.error('Tag remove error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}