import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/shopping-list/add-item
 * Adds a single item to the customer's active shopping list.
 *
 * Body options:
 *   { productId: number, quantity?: number }   → DB product
 *   { customName: string, quantity?: number }  → freeform item
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { productId, customName, quantity } = body || {};
    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    if (!productId && !customName) {
      return NextResponse.json(
        { error: 'Provide either productId or customName' },
        { status: 400 }
      );
    }

    // Get or create the active list
    let list = await prisma.shoppingList.findFirst({
      where: { customerId: session.customerId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!list) {
      list = await prisma.shoppingList.create({
        data: {
          customerId: session.customerId,
          name: `Shopping Trip ${new Date().toLocaleDateString('en-ZA')}`,
          isActive: true,
        },
      });
      console.log(`[ShoppingList] Auto-created list ${list.id} for add-item`);
    }

    // ---- DB product ----
    if (productId) {
      const product = await prisma.product.findUnique({
        where: { id: parseInt(productId, 10) },
      });
      if (!product) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }

      const existing = await prisma.shoppingListItem.findFirst({
        where: { listId: list.id, productId: product.id },
      });

      const item = existing
        ? await prisma.shoppingListItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + qty },
            include: { product: true },
          })
        : await prisma.shoppingListItem.create({
            data: {
              listId: list.id,
              productId: product.id,
              quantity: qty,
            },
            include: { product: true },
          });

      return NextResponse.json({
        success: true,
        item: {
          id: item.id,
          productId: item.productId,
          customName: null,
          name: item.product?.name,
          sku: item.product?.rfidTagId || null,
          priceCents: item.product?.priceCents || null,
          quantity: item.quantity,
          isScanned: item.isScanned,
        },
      });
    }

    // ---- Custom freeform item ----
    const trimmed = String(customName).trim().slice(0, 100);
    if (!trimmed) {
      return NextResponse.json({ error: 'customName is empty' }, { status: 400 });
    }

    // Prevent duplicates (case-insensitive)
    const duplicate = await prisma.shoppingListItem.findFirst({
      where: {
        listId: list.id,
        customName: { equals: trimmed, mode: 'insensitive' },
      },
    });

    const item = duplicate
      ? await prisma.shoppingListItem.update({
          where: { id: duplicate.id },
          data: { quantity: duplicate.quantity + qty },
        })
      : await prisma.shoppingListItem.create({
          data: {
            listId: list.id,
            customName: trimmed,
            quantity: qty,
          },
        });

    return NextResponse.json({
      success: true,
      item: {
        id: item.id,
        productId: null,
        customName: item.customName,
        name: item.customName,
        sku: null,
        priceCents: null,
        quantity: item.quantity,
        isScanned: item.isScanned,
      },
    });
  } catch (error: any) {
    console.error('Shopping list add-item error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}