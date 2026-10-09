import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    // Require login
    const session = await getSessionFromCookies(request.headers.get('cookie'));
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    const cartSession = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
      include: { items: true },
    });

    if (!cartSession) {
      return NextResponse.json(
        { error: `No active session found for cart ${cart_id}` },
        { status: 404 }
      );
    }

    if (cartSession.customerId !== session.customerId) {
      return NextResponse.json(
        { error: 'This cart is not linked to your account' },
        { status: 403 }
      );
    }

    if (!cartSession.isDocked) {
      return NextResponse.json(
        {
          error: 'Cart must be docked at the base station to enable payment.',
          isDocked: false,
        },
        { status: 403 }
      );
    }

    if ((cartSession.totalCents ?? 0) <= 0) {
      return NextResponse.json(
        { error: 'Cart total must be greater than zero to checkout.' },
        { status: 400 }
      );
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecret) {
      return NextResponse.json(
        { error: 'Payment service not configured' },
        { status: 500 }
      );
    }

    // Get the real customer email
    const customer = await prisma.customer.findUnique({
      where: { id: session.customerId },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const email = customer.email || `customer-${customer.id}@smartcart-demo.com`;

    // Reference format: PAYSTACK-CART_004-<timestamp>
    const reference = `PAYSTACK-${cart_id}-${Date.now()}`;

    const origin =
      process.env.NODE_ENV === 'production'
        ? 'https://smart-cart-5qod.vercel.app'
        : 'http://localhost:3000';

    const paystackResponse = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          amount: cartSession.totalCents ?? 0,
          currency: 'ZAR',
          reference: reference,
          callback_url: `${origin}/app.html?paid=true&cart_id=${cart_id}&reference=${reference}`,
          metadata: {
            type: 'cart_payment',
            cart_id: cart_id,
            session_id: cartSession.id,
            customer_id: customer.id,
          },
        }),
      }
    );

    const data = await paystackResponse.json();

    if (!data.status) {
      console.error('[Paystack create-intent] Error:', data.message);
      return NextResponse.json(
        { error: 'Paystack initialization failed', message: data.message },
        { status: 500 }
      );
    }

    // Pre-create a pending Transaction row so we can find it during verify
    await prisma.transaction.create({
      data: {
        sessionId: cartSession.id,
        amountCents: cartSession.totalCents ?? 0,
        currency: 'ZAR',
        status: 'pending',
        stripePaymentIntentId: reference, // reuse this field for Paystack ref
      },
    });

    return NextResponse.json({
      success: true,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: reference,
      amountCents: cartSession.totalCents ?? 0,
      currency: 'ZAR',
      cartId: cart_id,
      sessionId: cartSession.id,
    });
  } catch (error: any) {
    console.error('Error in /api/checkout/create-intent:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}