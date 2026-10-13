import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
      include: {
        tags: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return NextResponse.json({
      success: true,
      products: products.map(p => ({
        id: p.id,
        // Backwards-compat: first tag (used by existing simulator buttons)
        rfidTag: p.tags[0]?.rfidTagId ?? null,
        // New: full list of tags
        tags: p.tags.map(t => t.rfidTagId),
        name: p.name,
        priceCents: p.priceCents,
        priceRands: (p.priceCents / 100).toFixed(2),
        stockQuantity: p.stockQuantity,
      })),
    });
  } catch (error: any) {
    console.error('Product list error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}