import { NextResponse } from 'next/server';

import Stripe from 'stripe';
import { cartEventsBus } from '@/lib/events';

import { prisma } from '@/lib/prisma';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2023-10-16' as any,
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: Request) {
  const bodyText = await request.text();
  const sig = request.headers.get('stripe-signature');

  let event: Stripe.Event;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(bodyText, sig, webhookSecret);
    } else {
      // Development fallback parse
      event = JSON.parse(bodyText);
    }
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // Handle payment_intent.succeeded
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const { sessionId: sessionIdStr, cartId } = paymentIntent.metadata || {};
    const sessionId = sessionIdStr ? parseInt(sessionIdStr, 10) : null;

    if (sessionId) {
      // 1. Create Transaction Record
      await prisma.transaction.create({
        data: {
          sessionId,
          stripePaymentIntentId: paymentIntent.id,
          amountCents: paymentIntent.amount,
          currency: paymentIntent.currency.toUpperCase(),
          status: 'succeeded',
        },
      });

      // 2. Close active CartSession
      const closedSession = await prisma.cartSession.update({
        where: { id: sessionId },
        data: {
          isActive: false,
          closedAt: new Date(),
        },
      });

      // 3. Mark Cart status back to "available"
      await prisma.cart.update({
        where: { id: closedSession.cartId },
        data: { status: 'available' },
      });

      // 4. Emit SSE stream notification
      const streamPayload = {
        event: 'payment_succeeded',
        cartId: closedSession.cartId,
        sessionId: closedSession.id,
        paymentIntentId: paymentIntent.id,
        totalCents: paymentIntent.amount,
      };

      cartEventsBus.emit(`stream:${closedSession.cartId}`, streamPayload);
    }
  }

  return NextResponse.json({ received: true });
}
