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
      return NextResponse.json(
        { error: 'reference is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.walletTransaction.findFirst({
      where: {
        reference: reference,
        customerId: session.customerId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    if (existing.status === 'completed') {
      const customer = await prisma.customer.findUnique({
        where: { id: session.customerId },
        select: { walletBalanceCents: true },
      });
      return NextResponse.json({
        success: true,
        message: 'Already verified',
        newBalanceCents: customer?.walletBalanceCents ?? 0,
        newBalanceRands: ((customer?.walletBalanceCents ?? 0) / 100).toFixed(2),
      });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecret) {
      return NextResponse.json(
        { error: 'Payment service not configured' },
        { status: 500 }
      );
    }

    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
        },
      }
    );

    const verifyData = await verifyResponse.json();

    if (!verifyData.status || verifyData.data?.status !== 'success') {
      console.warn('[Paystack verify] Failed:', verifyData.message);

      await prisma.walletTransaction.update({
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

    const result = await prisma.$transaction(async (tx) => {
      await tx.walletTransaction.update({
        where: { id: existing.id },
        data: { status: 'completed' },
      });

      const updated = await tx.customer.update({
        where: { id: session.customerId },
        data: {
          walletBalanceCents: { increment: existing.amountCents },
        },
        select: { walletBalanceCents: true },
      });

      return updated;
    });

    return NextResponse.json({
      success: true,
      message: 'Wallet topped up successfully',
      creditedCents: existing.amountCents,
      creditedRands: (existing.amountCents / 100).toFixed(2),
      newBalanceCents: result.walletBalanceCents,
      newBalanceRands: (result.walletBalanceCents / 100).toFixed(2),
    });
  } catch (error: any) {
    console.error('Wallet verify error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}