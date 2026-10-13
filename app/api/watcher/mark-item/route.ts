import { NextResponse } from 'next/server';
import { cartEventsBus } from '@/lib/events';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/watcher/mark-item
 *
 * Body: {
 *   "cart_id": "cart_004",
 *   "item_id": 142,
 *   "action": "confirm" | "request-remove" | "clear-remove"
 * }
 *
 * Called by the watcher page.
 *
 *   confirm        → sets confirmedByWatcher = true  (visual only)
 *   request-remove → sets removeRequestedAt = now    (shopper sees it)
 *   clear-remove   → sets removeRequestedAt = null   (undo a request)
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
    const { cart_id, item_id, action } = body;

    if (!cart_id || !item_id || !action) {
      return NextResponse.json(
        { error: 'cart_id, item_id, and action are required' },
        { status: 400 }
      );
    }

    if (!['confirm', 'request-remove', 'clear-remove'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "confirm", "request-remove", or "clear-remove"' },
        { status: 400 }
      );
    }

    // ============================================================
    // 2. Find the active cart session for this customer + cart
    // ============================================================
    const cartSession = await prisma.cartSession.findFirst({
      where: {
        cartId: cart_id,
        customerId: session.customerId,
        isActive: true,
      },
    });

    if (!cartSession) {
      return NextResponse.json(
        { error: 'No active session for this cart linked to your account' },
        { status: 404 }
      );
    }

    // ============================================================
    // 3. Find the cart item
    // ============================================================
    const cartItem = await prisma.cartItem.findFirst({
      where: {
        id: item_id,
        sessionId: cartSession.id,
      },
      include: { product: true },
    });

    if (!cartItem) {
      return NextResponse.json(
        { error: 'Item not found in this cart session' },
        { status: 404 }
      );
    }

    // ============================================================
    // 4. Apply the action
    // ============================================================
    let updateData: any = {};
    let eventType = '';

    if (action === 'confirm') {
      updateData.confirmedByWatcher = true;
      eventType = 'watcher_confirmed';
    } else if (action === 'request-remove') {
      updateData.removeRequestedAt = new Date();
      eventType = 'watcher_remove_requested';
    } else if (action === 'clear-remove') {
      updateData.removeRequestedAt = null;
      eventType = 'watcher_remove_cleared';
    }

    const updated = await prisma.cartItem.update({
      where: { id: cartItem.id },
      data: updateData,
    });

    // ============================================================
    // 5. Emit SSE event
    // ============================================================
    const streamPayload = {
      event: eventType,
      cartId: cart_id,
      sessionId: cartSession.id,
      itemId: cartItem.id,
      sku: cartItem.product.rfidTagId,
      name: cartItem.product.name,
      confirmedByWatcher: updated.confirmedByWatcher,
      removeRequestedAt: updated.removeRequestedAt?.toISOString() ?? null,
    };
    cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

    return NextResponse.json({
      success: true,
      message: `Item ${action} applied`,
      item: {
        id: updated.id,
        sku: cartItem.product.rfidTagId,
        name: cartItem.product.name,
        confirmedByWatcher: updated.confirmedByWatcher,
        removeRequestedAt: updated.removeRequestedAt?.toISOString() ?? null,
      },
    });
  } catch (error: any) {
    console.error('Error in /api/watcher/mark-item:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}