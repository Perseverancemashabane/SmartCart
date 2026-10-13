import { NextResponse } from 'next/server';
import { cartEventsBus } from '@/lib/events';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/cart/unlock-abandoned
 *
 * Body: { "cart_id": "cart_004" }
 *
 * Called by the cart firmware when someone presses "#" on the
 * "Cart Locked" screen (which appears 5 minutes after the shopper
 * confirmed payment but never docked).
 *
 * Effects:
 *   - Clears cartAbandoned flag on the active cart session
 *   - Emits "cart_abandoned_cleared" SSE event so watchers/admin
 *     dashboards update
 *
 * No session required — the cart's identity comes from cart_id.
 * The physical presence at the cart is the "authentication".
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json(
        { error: 'cart_id is required' },
        { status: 400 }
      );
    }

    // Find the active session
    const cartSession = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!cartSession) {
      return NextResponse.json(
        { error: 'No active session for this cart' },
        { status: 404 }
      );
    }

    if (!cartSession.cartAbandoned) {
      // Nothing to do — flag was not set
      return NextResponse.json({
        success: true,
        message: 'Cart was not marked as abandoned',
        cartId: cart_id,
      });
    }

    // Clear the flag
    const updated = await prisma.cartSession.update({
      where: { id: cartSession.id },
      data: { cartAbandoned: false },
    });

    // Emit SSE so the admin dashboard can clear the alert
    const streamPayload = {
      event: 'cart_abandoned_cleared',
      cartId: cart_id,
      sessionId: updated.id,
      cartAbandoned: false,
    };
    cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

    return NextResponse.json({
      success: true,
      message: 'Cart unlocked. Normal flow resumed.',
      cartId: cart_id,
      sessionId: updated.id,
    });
  } catch (error: any) {
    console.error('Error in /api/cart/unlock-abandoned:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}