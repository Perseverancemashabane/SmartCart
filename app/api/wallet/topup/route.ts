import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { amountCents } = body;

    if (!amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
      return NextResponse.json(
        { error: 'amountCents must be a positive number' },
        { status: 400 }
      );
    }

    if (amountCents < 1000) {
      return NextResponse.json(
        { error: 'Minimum top-up is R10.00' },
        { status: 400 }
      );
    }

    if (amountCents > 500000) {
      return NextResponse.json(
        { error: 'Maximum top-up is R5000.00' },
        { status: 400 }
      );
    }

    const customer = await prisma.customer.findUnique({
      where: { id: session.customerId },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecret) {
      console.error('PAYSTACK_SECRET_KEY is not set');
      return NextResponse.json(
        { error: 'Payment service not configured' },
        { status: 500 }
      );
    }

    const reference = `WALLET-${customer.id}-${Date.now()}`;
    const email = customer.email || `customer-${customer.id}@smartcart-demo.com`;

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
          amount: amountCents,
          currency: 'ZAR',
          reference: reference,
          callback_url: `${origin}/wallet.html?topup=success&reference=${reference}`,
          metadata: {
            type: 'wallet_topup',
            customer_id: customer.id,
            amount_cents: amountCents,
          },
        }),
      }
    );

    const data = await paystackResponse.json();

    if (!data.status) {
      console.error('[Paystack topup] Error:', data.message);
      return NextResponse.json(
        { error: 'Paystack initialization failed', message: data.message },
        { status: 500 }
      );
    }

    await prisma.walletTransaction.create({
      data: {
        customerId: customer.id,
        amountCents: amountCents,
        type: 'credit',
        status: 'pending',
        reference: reference,
      },
    });

    return NextResponse.json({
      success: true,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
      amountCents: amountCents,
    });
  } catch (error: any) {
    console.error('Wallet topup error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}