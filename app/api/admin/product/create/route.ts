import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { name, priceCents, stockQuantity } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    if (typeof priceCents !== 'number' || priceCents < 0) {
      return NextResponse.json(
        { error: 'priceCents must be a positive number' },
        { status: 400 }
      );
    }

    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        priceCents,
        stockQuantity: typeof stockQuantity === 'number' ? stockQuantity : 0,
      },
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
    console.error('Product create error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}