import { NextResponse } from 'next/server';
import { cartEventsBus } from '@/lib/events';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/cart/anti-theft-trigger
 *
 * Body: { "cart_id": "cart_004", "reason": "undocked_after_pending" }
 *
 * Called by the cart firmware when the anti-theft alarm fires.
 *
 * Effects:
 *   - Sets alarmTriggered = true on the active session
 *   - Creates an Alert record (type = "anti_theft")
 *   - Emits SSE event "anti_theft_triggered"
 *
 * No session cookie required — the cart calls this.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id, reason } = body;

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

    // Set alarmTriggered on the session
    const updated = await prisma.cartSession.update({
      where: { id: cartSession.id },
      data: { alarmTriggered: true },
    });

    // Create an Alert record
    const alert = await prisma.alert.create({
      data: {
        cartId: cart_id,
        sessionId: cartSession.id,
        type: 'anti_theft',
        reason: reason || 'Cart undocked after payment was requested',
      },
    });

    // Emit SSE
    const streamPayload = {
      event: 'anti_theft_triggered',
      cartId: cart_id,
      sessionId: cartSession.id,
      alertId: alert.id,
      reason: alert.reason,
      alarmTriggered: true,
    };
    cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

    return NextResponse.json({
      success: true,
      message: 'Anti-theft alarm triggered',
      cartId: cart_id,
      alertId: alert.id,
      sessionId: cartSession.id,
    });
  } catch (error: any) {
    console.error('Error in /api/cart/anti-theft-trigger:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}