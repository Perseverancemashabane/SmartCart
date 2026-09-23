import { NextResponse } from 'next/server';

import Stripe from 'stripe';

import { prisma } from '@/lib/prisma';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock_secret_key', {
  apiVersion: '2023-10-16' as any,
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    // Lookup active CartSession
    const session = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
      include: { items: true },
    });

    if (!session) {
      return NextResponse.json({ error: `No active session found for cart ${cart_id}` }, { status: 404 });
    }

    // Validate that cart is physically docked at base station
    if (!session.isDocked) {
      return NextResponse.json({
        error: 'Cart must be docked at the base station to enable payment.',
        isDocked: false,
      }, { status: 403 });
    }

   if ((session.totalCents ?? 0) <= 0) {
      return NextResponse.json({ error: 'Cart total must be greater than zero to checkout.' }, { status: 400 });
    }

    // Create Stripe PaymentIntent in ZAR currency
    let clientSecret = 'mock_client_secret_demo';
    let paymentIntentId = 'pi_mock_' + Date.now();

    if (process.env.STRIPE_SECRET_KEY) {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: session.totalCents ?? 0,
        currency: 'zar',
        description: `SmartCart ${cart_id} Checkout Payment`,
        metadata: {
          sessionId: session.id,
          cartId: cart_id,
        },
      });
      clientSecret = paymentIntent.client_secret || '';
      paymentIntentId = paymentIntent.id;
    }

    return NextResponse.json({
      success: true,
      clientSecret,
      paymentIntentId,
      amountCents: session.totalCents,
      currency: 'ZAR',
      cartId: cart_id,
      sessionId: session.id,
    });
  } catch (error: any) {
    console.error('Error in /api/checkout/create-intent:', error);
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 });
  }
}
