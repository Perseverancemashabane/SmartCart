import { NextResponse } from 'next/server';
import { cartEventsBus } from '@/lib/events';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/cart/cancel-payment
 *
 * Body: { "cart_id": "cart_004" }
 *
 * Called by the shopper's phone if they tap "Cancel" on the
 * "Dock the cart now to enable payment" screen.
 *
 * Effects:
 *   - Resets paymentStatus back to "unpaid"
 *   - Clears paymentRequestedAt
 *   - Only works if cart is NOT docked
 *
 * If the cart is already docked (TFT shows "Payment Unlocked"),
 * the request is rejected with 403. Once docked, the shopper must
 * complete payment or staff must intervene.
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
    // 4. Refuse if the cart is already docked
    // ============================================================
    if (cartSession.isDocked) {
      return NextResponse.json(
        {
          error: 'Cannot cancel — cart is docked. Please complete payment or contact staff.',
        },
        { status: 403 }
      );
    }

    // ============================================================
    // 5. Reset the payment flags
    // ============================================================
    const updated = await prisma.cartSession.update({
      where: { id: cartSession.id },
      data: {
        paymentStatus: 'unpaid',
        paymentRequestedAt: null,
      },
    });

    // ============================================================
    // 6. Emit SSE so cart dashboard reflects the change
    // ============================================================
    const streamPayload = {
      event: 'payment_cancelled',
      cartId: cart_id,
      sessionId: updated.id,
      paymentStatus: 'unpaid',
    };
    cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

    return NextResponse.json({
      success: true,
      message: 'Payment cancelled. You can continue shopping.',
      cartId: cart_id,
      paymentStatus: 'unpaid',
    });
  } catch (error: any) {
    console.error('Error in /api/cart/cancel-payment:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}