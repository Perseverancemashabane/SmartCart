import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/watcher/state
 *
 * Body: (empty — customer comes from session cookie)
 *
 * Returns the live cart contents for the logged-in customer's
 * active cart session. Used by the watcher page (someone at home
 * watching the shopper's cart).
 *
 * Response includes:
 *   - cart info (id, isDocked, paymentStatus)
 *   - scanned items with their watcher flags
 *   - shopping list items with their watcher flags
 *   - totals
 *
 * The watcher polls this endpoint every ~2 seconds.
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

    // ============================================================
    // 2. Find the customer's active cart session
    // ============================================================
    const cartSession = await prisma.cartSession.findFirst({
      where: {
        customerId: session.customerId,
        isActive: true,
      },
      include: {
        cart: true,
        items: {
          include: { product: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ============================================================
    // 3. Find the customer's active shopping list
    // ============================================================
    const shoppingList = await prisma.shoppingList.findFirst({
      where: {
        customerId: session.customerId,
        isActive: true,
      },
      include: {
        items: {
          include: { product: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ============================================================
    // 4. Build response
    // ============================================================

    // Cart state (may be null if customer isn't shopping)
    let cartPayload = null;
    if (cartSession) {
      cartPayload = {
        cartId: cartSession.cartId,
        sessionId: cartSession.id,
        isDocked: cartSession.isDocked ?? false,
        paymentStatus: cartSession.paymentStatus,
        paymentRequestedAt: cartSession.paymentRequestedAt?.toISOString() ?? null,
        cartAbandoned: cartSession.cartAbandoned,
        alarmTriggered: cartSession.alarmTriggered,
        subtotalCents: cartSession.subtotalCents ?? 0,
        taxCents: cartSession.taxCents ?? 0,
        totalCents: cartSession.totalCents ?? 0,
        items: cartSession.items.map((item) => ({
          id: item.id,
          sku: item.product.rfidTagId,
          name: item.product.name,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity ?? 1,
          subtotalCents: item.subtotalCents,
          confirmedByWatcher: item.confirmedByWatcher,
          removeRequestedAt: item.removeRequestedAt?.toISOString() ?? null,
        })),
      };
    }

    // Shopping list (may be null if customer has no list)
    let listPayload = null;
    if (shoppingList) {
      listPayload = {
        listId: shoppingList.id,
        name: shoppingList.name,
        createdAt: shoppingList.createdAt.toISOString(),
        items: shoppingList.items.map((item) => ({
          id: item.id,
          name: item.customName ?? item.product?.name ?? 'Unknown item',
          productId: item.productId,
          sku: item.product?.rfidTagId ?? null,
          quantity: item.quantity,
          isScanned: item.isScanned,
          scannedAt: item.scannedAt?.toISOString() ?? null,
          removeRequestedAt: item.removeRequestedAt?.toISOString() ?? null,
        })),
        progress: {
          total: shoppingList.items.length,
          found: shoppingList.items.filter((i) => i.isScanned).length,
          remaining: shoppingList.items.filter((i) => !i.isScanned).length,
        },
      };
    }

    return NextResponse.json({
      success: true,
      cart: cartPayload,
      shoppingList: listPayload,
      customer: {
        id: session.customerId,
        phoneNumber: session.phoneNumber,
      },
    });
  } catch (error: any) {
    console.error('Error in /api/watcher/state:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}