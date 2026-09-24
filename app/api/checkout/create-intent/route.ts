import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    const session = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
      include: { items: true },
    });

    if (!session) {
      return NextResponse.json({ error: `No active session found for cart ${cart_id}` }, { status: 404 });
    }

    if (!session.isDocked) {
      return NextResponse.json({
        error: 'Cart must be docked at the base station to enable payment.',
        isDocked: false,
      }, { status: 403 });
    }

    if ((session.totalCents ?? 0) <= 0) {
      return NextResponse.json({ error: 'Cart total must be greater than zero to checkout.' }, { status: 400 });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecret) {
      return NextResponse.json({
        success: true,
        clientSecret: 'mock_client_secret_demo',
        paymentIntentId: 'mock_' + Date.now(),
        amountCents: session.totalCents ?? 0,
        currency: 'ZAR',
        cartId: cart_id,
        sessionId: session.id,
        mock: true,
      });
    }

    const reference = `SC-${cart_id}-${Date.now()}`;
    const email = `cart-${cart_id}@smartcart-demo.com`;

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        amount: session.totalCents ?? 0,
        currency: 'ZAR',
        reference: reference,
        callback_url: `https://smart-cart-5qod.vercel.app/app.html?paid=true&cart_id=${cart_id}`,
        metadata: {
          cart_id: cart_id,
          session_id: session.id,
        },
      }),
    });

    const data = await paystackResponse.json();

    if (!data.status) {
      console.error('[Paystack] Error:', data.message);
      return NextResponse.json({
        error: 'Paystack initialization failed',
        message: data.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
      amountCents: session.totalCents ?? 0,
      currency: 'ZAR',
      cartId: cart_id,
      sessionId: session.id,
    });
  } catch (error: any) {
    console.error('Error in /api/checkout/create-intent:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}