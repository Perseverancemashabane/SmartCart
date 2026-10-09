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
    const { reference } = body;

    if (!reference) {
      return NextResponse.json({ error: 'reference is required' }, { status: 400 });
    }

    // Find the pending Transaction we pre-created
    const existing = await prisma.transaction.findUnique({
      where: { stripePaymentIntentId: reference },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Transaction not found for this reference' },
        { status: 404 }
      );
    }

    // Already completed? Idempotent response.
    if (existing.status === 'completed') {
      return NextResponse.json({
        success: true,
        message: 'Already verified',
        transactionId: existing.id,
        amountCents: existing.amountCents,
        amountRands: (existing.amountCents / 100).toFixed(2),
      });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return NextResponse.json(
        { error: 'Payment service not configured' },
        { status: 500 }
      );
    }

    // Verify with Paystack
    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${paystackSecret}` },
      }
    );

    const verifyData = await verifyResponse.json();

    if (!verifyData.status || verifyData.data?.status !== 'success') {
      console.warn('[Paystack verify] Not successful:', verifyData.data?.status);
      await prisma.transaction.update({
        where: { id: existing.id },
        data: { status: 'failed' },
      });
      return NextResponse.json(
        {
          error: 'Payment was not successful',
          status: verifyData.data?.status || 'unknown',
        },
        { status: 400 }
      );
    }

    // Verify amount matches
    const paidAmount = verifyData.data.amount;
    if (paidAmount !== existing.amountCents) {
      console.warn('[Paystack verify] Amount mismatch', {
        expected: existing.amountCents,
        paid: paidAmount,
      });
      return NextResponse.json(
        { error: 'Payment amount mismatch' },
        { status: 400 }
      );
    }

    // Mark as completed
    const updated = await prisma.transaction.update({
      where: { id: existing.id },
      data: { status: 'completed' },
    });

    return NextResponse.json({
      success: true,
      message: 'Payment verified',
      transactionId: updated.id,
      amountCents: updated.amountCents,
      amountRands: (updated.amountCents / 100).toFixed(2),
    });
  } catch (error: any) {
    console.error('Checkout verify error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}