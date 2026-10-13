import { NextResponse } from 'next/server';
import { cartEventsBus } from '@/lib/events';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/cart/confirm-payment
 *
 * Body: { "cart_id": "cart_004" }
 *
 * Called by the shopper's phone when they tap "Confirm & Pay" on the
 * review screen.
 *
 * Effects:
 *   - Sets session.paymentStatus = "pending"
 *   - Sets session.paymentRequestedAt = now
 *   - Emits "payment_requested" SSE event to the cart stream
 *
 * After this, the cart firmware shows "Dock the cart now to enable
 * payment". Docking completes the flow. Undocking before payment
 * triggers the anti-theft alarm.
 *
 * Requires the shopper's session cookie (they must be logged in).
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
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json(
        { error: 'cart_id is required' },
        { status: 400 }
      );
    }

    // ============================================================
    // 2. Find the active cart session
    // ============================================================
    const cartSession = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
      include: {
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!cartSession) {
      return NextResponse.json(
        { error: 'No active session for this cart' },
        { status: 404 }
      );
    }

    // ============================================================
    // 3. Verify ownership
    // ============================================================
    if (cartSession.customerId !== session.customerId) {
      return NextResponse.json(
        { error: 'This cart is not linked to your account' },
        { status: 403 }
      );
    }

    // ============================================================
    // 4. Reject if empty
    // ============================================================
    if ((cartSession.totalCents ?? 0) <= 0) {
      return NextResponse.json(
        { error: 'Cart is empty — nothing to pay' },
        { status: 400 }
      );
    }

    // ============================================================
    // 5. Mark payment requested
    // ============================================================
    const updated = await prisma.cartSession.update({
      where: { id: cartSession.id },
      data: {
        paymentStatus: 'pending',
        paymentRequestedAt: new Date(),
      },
    });

    // ============================================================
    // 6. Emit SSE event to the cart
    // ============================================================
    const streamPayload = {
      event: 'payment_requested',
      cartId: cart_id,
      sessionId: updated.id,
      paymentStatus: 'pending',
      paymentRequestedAt: updated.paymentRequestedAt?.toISOString() ?? null,
      totalCents: updated.totalCents ?? 0,
      items: cartSession.items.map((i) => ({
        id: i.id,
        sku: i.product.rfidTagId,
        name: i.product.name,
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
        subtotalCents: i.subtotalCents,
      })),
    };

    cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

    return NextResponse.json({
      success: true,
      message: 'Payment requested. Dock the cart to continue.',
      cartId: cart_id,
      sessionId: updated.id,
      paymentStatus: 'pending',
    });
  } catch (error: any) {
    console.error('Error in /api/cart/confirm-payment:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}