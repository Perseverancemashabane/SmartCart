import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { productId, name, priceCents, stockQuantity } = body;

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    const data: any = {};
    if (typeof name === 'string' && name.trim().length > 0) data.name = name.trim();
    if (typeof priceCents === 'number' && priceCents >= 0) data.priceCents = priceCents;
    if (typeof stockQuantity === 'number' && stockQuantity >= 0) data.stockQuantity = stockQuantity;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data,
    });

    return NextResponse.json({
      success: true,
      product: {
        id: product.id,
        name: product.name,
        priceCents: product.priceCents,
        stockQuantity: product.stockQuantity,
      },
    });
  } catch (error: any) {
    console.error('Product update error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}