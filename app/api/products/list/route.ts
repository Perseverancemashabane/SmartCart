import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // Fetch products WITHOUT the tags relation
    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
    });

    // Fetch all active tags in one query
    const allTags = await prisma.productTag.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group tags by productId
    const tagsByProduct: Record<number, string[]> = {};
    for (const tag of allTags) {
      if (!tagsByProduct[tag.productId]) {
        tagsByProduct[tag.productId] = [];
      }
      tagsByProduct[tag.productId].push(tag.rfidTagId);
    }

    return NextResponse.json(
      {
        success: true,
        products: products.map(p => ({
          id: p.id,
          rfidTag: tagsByProduct[p.id]?.[0] ?? null,
          tags: tagsByProduct[p.id] ?? [],
          name: p.name,
          priceCents: p.priceCents,
          priceRands: (p.priceCents / 100).toFixed(2),
          stockQuantity: p.stockQuantity,
        })),
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (error: any) {
    console.error('Product list error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}