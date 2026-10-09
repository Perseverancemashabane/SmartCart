import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/shopping-list/remove-item
 * Body: { itemId: number, decreaseOnly?: boolean }
 *
 * Default: removes the entire item from the list.
 * If decreaseOnly: true AND quantity > 1, decrements quantity by 1 instead.
 * If decreaseOnly: true AND quantity === 1, removes the item.
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { itemId, decreaseOnly } = body || {};

    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }

    // Verify the item belongs to this customer's active list
    const item = await prisma.shoppingListItem.findUnique({
      where: { id: parseInt(itemId, 10) },
      include: { list: true },
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (item.list.customerId !== session.customerId || !item.list.isActive) {
      return NextResponse.json(
        { error: 'Item does not belong to your active list' },
        { status: 403 }
      );
    }

    // Decrement mode
    if (decreaseOnly && item.quantity > 1) {
      const updated = await prisma.shoppingListItem.update({
        where: { id: item.id },
        data: { quantity: item.quantity - 1 },
      });
      return NextResponse.json({
        success: true,
        removed: false,
        item: {
          id: updated.id,
          quantity: updated.quantity,
        },
      });
    }

    // Full removal
    await prisma.shoppingListItem.delete({
      where: { id: item.id },
    });

    return NextResponse.json({
      success: true,
      removed: true,
      itemId: item.id,
    });
  } catch (error: any) {
    console.error('Shopping list remove-item error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}