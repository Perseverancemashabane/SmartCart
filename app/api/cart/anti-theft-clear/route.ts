import { NextResponse } from 'next/server';
import { cartEventsBus } from '@/lib/events';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/cart/anti-theft-clear
 *
 * Body: { "cart_id": "cart_004", "action": "continue" | "cancel" }
 *
 * Called by the cart firmware after a staff member has entered the
 * correct staff PIN on the alarm screen. The staff member chooses:
 *
 *   action = "continue" → cart returns to "Payment Unlocked".
 *                         alarmTriggered stays true (audit log).
 *                         Cart cannot be undocked again.
 *
 *   action = "cancel"   → session is closed. All cart items cleared.
 *                         Cart resets to idle for next customer.
 *                         Staff physically handles the items.
 *
 * No session cookie required — the cart's identity comes from cart_id.
 * The staff PIN entry on the cart is the authentication.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id, action } = body;

    if (!cart_id) {
      return NextResponse.json(
        { error: 'cart_id is required' },
        { status: 400 }
      );
    }

    if (action !== 'continue' && action !== 'cancel') {
      return NextResponse.json(
        { error: 'action must be "continue" or "cancel"' },
        { status: 400 }
      );
    }

    // Find the active cart session
    const cartSession = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!cartSession) {
      return NextResponse.json(
        { error: 'No active session for this cart' },
        { status: 404 }
      );
    }

    // ============================================================
    // action = "continue"
    // ============================================================
    if (action === 'continue') {
      // Just confirm the state. alarmTriggered stays true (audit).
      // paymentStatus remains whatever it was (usually "pending").
      // Cart returns to "Payment Unlocked" and customer pays normally.
      const streamPayload = {
        event: 'anti_theft_cleared',
        cartId: cart_id,
        sessionId: cartSession.id,
        action: 'continue',
        alarmTriggered: cartSession.alarmTriggered,
        paymentStatus: cartSession.paymentStatus,
        totalCents: cartSession.totalCents ?? 0,
      };
      cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

      return NextResponse.json({
        success: true,
        message: 'Anti-theft cleared. Customer may continue to payment.',
        cartId: cart_id,
        sessionId: cartSession.id,
        action: 'continue',
      });
    }

    // ============================================================
    // action = "cancel"
    // ============================================================
    // Delete all items, close session, reset cart status
    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.cartItem.deleteMany({
        where: { sessionId: cartSession.id },
      });

      await tx.cartSession.update({
        where: { id: cartSession.id },
        data: {
          isActive: false,
          isDocked: false,
          subtotalCents: 0,
          taxCents: 0,
          totalCents: 0,
          closedAt: new Date(),
          alarmTriggered: true,   // keep for audit
          cartAbandoned: false,
          paymentStatus: 'unpaid',
        },
      });

      await tx.cart.update({
        where: { id: cart_id },
        data: { status: 'available' },
      });

      return { deletedCount: deleted.count };
    });

    const streamPayload = {
      event: 'anti_theft_cancelled',
      cartId: cart_id,
      sessionId: cartSession.id,
      action: 'cancel',
      itemsDeleted: result.deletedCount,
    };
    cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

    return NextResponse.json({
      success: true,
      message: 'Cart cancelled. Items cleared. Staff handles items.',
      cartId: cart_id,
      action: 'cancel',
      itemsDeleted: result.deletedCount,
    });
  } catch (error: any) {
    console.error('Error in /api/cart/anti-theft-clear:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}