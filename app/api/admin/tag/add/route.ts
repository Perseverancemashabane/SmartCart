import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

/**
 * POST /api/admin/tag/add
 * Body: { productId, rfidTagId }
 */
export async function POST(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { productId, rfidTagId } = body;

    if (!productId || !rfidTagId) {
      return NextResponse.json(
        { error: 'productId and rfidTagId are required' },
        { status: 400 }
      );
    }

    const tag = rfidTagId.trim().toUpperCase();

    // Check if tag already exists
    const existing = await prisma.productTag.findUnique({
      where: { rfidTagId: tag },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Tag ${tag} is already assigned to product ${existing.productId}` },
        { status: 409 }
      );
    }

    const created = await prisma.productTag.create({
      data: {
        rfidTagId: tag,
        productId,
        isActive: true,
      },
    });

    return NextResponse.json({
      success: true,
      tag: {
        id: created.id,
        rfidTagId: created.rfidTagId,
        productId: created.productId,
      },
    });
  } catch (error: any) {
    console.error('Tag add error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}