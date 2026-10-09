import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * GET /api/shopping-list/active
 * Returns the customer's current active shopping list with progress stats.
 */
export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const list = await prisma.shoppingList.findFirst({
      where: {
        customerId: session.customerId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { product: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!list) {
      return NextResponse.json({
        success: true,
        list: null,
      });
    }

    const items = list.items.map(item => ({
      id: item.id,
      productId: item.productId,
      customName: item.customName,
      name: item.product?.name || item.customName || 'Unknown item',
      sku: item.product?.rfidTagId || null,
      priceCents: item.product?.priceCents || null,
      priceRands: item.product ? (item.product.priceCents / 100).toFixed(2) : null,
      quantity: item.quantity,
      isScanned: item.isScanned,
      scannedAt: item.scannedAt,
    }));

    const total = items.length;
    const found = items.filter(i => i.isScanned).length;

    return NextResponse.json({
      success: true,
      list: {
        id: list.id,
        name: list.name,
        isActive: list.isActive,
        createdAt: list.createdAt,
        items,
        total,
        found,
        remaining: total - found,
        progressPercent: total > 0 ? Math.round((found / total) * 100) : 0,
      },
    });
  } catch (error: any) {
    console.error('Shopping list active error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}