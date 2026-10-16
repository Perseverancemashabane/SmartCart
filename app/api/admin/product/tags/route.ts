import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

/**
 * POST /api/admin/product/tags
 * Body: { productId }
 */
export async function POST(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    const tags = await prisma.productTag.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      tags: tags.map(t => ({
        id: t.id,
        rfidTagId: t.rfidTagId,
        isActive: t.isActive,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error('Product tags error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}