import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/watcher/list/add
 *
 * Body: { "name": "Bread", "quantity": 1 }
 *
 * Adds an item to the logged-in customer's active shopping list.
 * If the customer has no active list, one is created.
 *
 * The backend attempts to match the free-text name to a known product.
 * If a match is found, productId is set — which allows auto-checkoff
 * when the shopper scans that product's RFID tag.
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
    const { name, quantity } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;

    // ============================================================
    // 2. Find or create the active shopping list
    // ============================================================
    let list = await prisma.shoppingList.findFirst({
      where: {
        customerId: session.customerId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!list) {
      list = await prisma.shoppingList.create({
        data: {
          customerId: session.customerId,
          isActive: true,
        },
      });
    }

    // ============================================================
    // 3. Try to match the free-text name to a known product
    //    Case-insensitive partial match — takes the first result.
    // ============================================================
    const trimmed = name.trim();
    const matchedProduct = await prisma.product.findFirst({
      where: {
        name: {
          contains: trimmed,
          mode: 'insensitive',
        },
      },
    });

    // ============================================================
    // 4. Create the list item
    // ============================================================
    const listItem = await prisma.shoppingListItem.create({
      data: {
        listId: list.id,
        productId: matchedProduct?.id ?? null,
        customName: matchedProduct ? null : trimmed,
        quantity: qty,
        isScanned: false,
      },
      include: { product: true },
    });

    return NextResponse.json({
      success: true,
      message: `Added "${trimmed}" to your shopping list`,
      listId: list.id,
      item: {
        id: listItem.id,
        name: matchedProduct?.name ?? trimmed,
        productId: matchedProduct?.id ?? null,
        sku: matchedProduct?.rfidTagId ?? null,
        quantity: listItem.quantity,
        isScanned: listItem.isScanned,
        matchedToProduct: !!matchedProduct,
      },
    });
  } catch (error: any) {
    console.error('Error in /api/watcher/list/add:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}