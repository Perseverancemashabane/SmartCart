import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/watcher/list/remove
 *
 * Body: { "item_id": 12 }
 *
 * Removes an item from the logged-in customer's active shopping list.
 *
 * Requires the shopper's session cookie.
 */
export async function POST(request: Request) {
  try {
    // ============================================================
    // 1. Require login
    // ============================================================
    const session = await getSessionFromCookies(request.headers.get('cookie'));
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { item_id } = body;

    if (!item_id) {
      return NextResponse.json(
        { error: 'item_id is required' },
        { status: 400 }
      );
    }

    // ============================================================
    // 2. Find the list item + verify it belongs to this customer
    // ============================================================
    const listItem = await prisma.shoppingListItem.findUnique({
      where: { id: item_id },
      include: { list: true },
    });

    if (!listItem) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      );
    }

    if (listItem.list.customerId !== session.customerId) {
      return NextResponse.json(
        { error: 'This item does not belong to your account' },
        { status: 403 }
      );
    }

    // ============================================================
    // 3. Delete it
    // ============================================================
    await prisma.shoppingListItem.delete({
      where: { id: item_id },
    });

    return NextResponse.json({
      success: true,
      message: 'Item removed from shopping list',
      itemId: item_id,
    });
  } catch (error: any) {
    console.error('Error in /api/watcher/list/remove:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}