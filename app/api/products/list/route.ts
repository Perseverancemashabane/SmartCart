import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        rfidTagId: true,
        name: true,
        priceCents: true,
        stockQuantity: true,
      },
    });

    return NextResponse.json({
      success: true,
      products: products.map(p => ({
        id: p.id,
        rfidTag: p.rfidTagId,
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