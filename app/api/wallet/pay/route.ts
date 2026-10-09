import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies, verifyPinById } from '@/lib/auth';

const MAX_PIN_ATTEMPTS = 3;

export async function POST(request: Request) {
  try {
    // ============================================================
    // 1. Require login
    // ============================================================
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { cart_id, pin } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be 4 to 6 digits' },
        { status: 400 }
      );
    }

    // ============================================================
    // 2. Find the active cart session
    // ============================================================
    const cartSession = await prisma.cartSession.findFirst({
      where: {
        cartId: cart_id,
        isActive: true,
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
    // 3. Verify the session belongs to this customer
    // ============================================================
    if (cartSession.customerId !== session.customerId) {
      return NextResponse.json(
        { error: 'This cart is not linked to your account' },
        { status: 403 }
      );
    }

    // ============================================================
    // 4. Cart must be docked
    // ============================================================
    if (!cartSession.isDocked) {
      return NextResponse.json(
        { error: 'Cart must be docked at the base station to pay' },
        { status: 400 }
      );
    }

    // ============================================================
    // 5. Cart must have a total
    // ============================================================
    const totalCents = cartSession.totalCents || 0;
    if (totalCents <= 0) {
      return NextResponse.json(
        { error: 'Cart is empty — nothing to pay' },
        { status: 400 }
      );
    }

    // ============================================================
    // 6. Verify PIN
    // ============================================================
    const pinResult = await verifyPinById(session.customerId, pin);

    if (!pinResult.valid) {
      return NextResponse.json(
        { error: pinResult.reason || 'Incorrect PIN' },
        { status: 401 }
      );
    }

    // ============================================================
    // 7. Check wallet balance
    // ============================================================
    const customer = await prisma.customer.findUnique({
      where: { id: session.customerId },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    if (customer.walletBalanceCents < totalCents) {
      return NextResponse.json(
        {
          error: 'Insufficient wallet balance',
          requiredCents: totalCents,
          requiredRands: (totalCents / 100).toFixed(2),
          availableCents: customer.walletBalanceCents,
          availableRands: (customer.walletBalanceCents / 100).toFixed(2),
        },
        { status: 400 }
      );
    }

    // ============================================================
    // 8. Atomic transaction: deduct + log + close cart
    // ============================================================
    const result = await prisma.$transaction(async (tx) => {
      const debit = await tx.walletTransaction.create({
        data: {
          customerId: session.customerId,
          amountCents: totalCents,
          type: 'debit',
          status: 'completed',
         reference: `${cart_id}_${Date.now()}`,
        },
      });

      const updatedCustomer = await tx.customer.update({
        where: { id: session.customerId },
        data: {
          walletBalanceCents: { decrement: totalCents },
        },
        select: {
          walletBalanceCents: true,
        },
      });

      await tx.cartSession.update({
        where: { id: cartSession.id },
        data: {
          isActive: false,
          closedAt: new Date(),
        },
      });

      await tx.transaction.create({
        data: {
          sessionId: cartSession.id,
          amountCents: totalCents,
          currency: 'ZAR',
          status: 'completed',
          stripePaymentIntentId: `WALLET_${debit.id}`,
        },
      });

      return {
        transaction: debit,
        newBalance: updatedCustomer.walletBalanceCents,
      };
    });

    // ============================================================
    // 9. Success
    // ============================================================
    return NextResponse.json({
      success: true,
      message: 'Payment successful',
      paidCents: totalCents,
      paidRands: (totalCents / 100).toFixed(2),
      newBalanceCents: result.newBalance,
      newBalanceRands: (result.newBalance / 100).toFixed(2),
      transactionId: result.transaction.id,
      reference: result.transaction.reference,
    });
  } catch (error: any) {
    console.error('Wallet pay error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}