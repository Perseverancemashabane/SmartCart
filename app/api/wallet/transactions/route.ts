import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Wallet transactions
    const walletTxs = await prisma.walletTransaction.findMany({
      where: { customerId: session.customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Cart sessions for this customer
    const customerSessions = await prisma.cartSession.findMany({
      where: { customerId: session.customerId },
      select: { id: true },
    });

    const sessionIds = customerSessions.map(s => s.id);

    // Only fetch cart transactions that are NOT wallet payments
    // (wallet payments already show up as wallet_transactions debits)
    const cartTxs = sessionIds.length > 0
      ? await prisma.transaction.findMany({
          where: {
            sessionId: { in: sessionIds },
            NOT: { stripePaymentIntentId: { startsWith: 'WALLET_' } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : [];

    const walletNormalized = walletTxs.map((tx) => ({
      id: `wallet_${tx.id}`,
      source: 'wallet',
      amountCents: tx.amountCents,
      amountRands: (tx.amountCents / 100).toFixed(2),
      type: tx.type,
      status: tx.status,
      reference: tx.reference,
      createdAt: tx.createdAt,
      label: tx.type === 'credit' ? 'Top Up' : 'Wallet Payment',
    }));

    const cartNormalized = cartTxs.map((tx) => ({
      id: `cart_${tx.id}`,
      source: 'cart',
      amountCents: tx.amountCents,
      amountRands: (tx.amountCents / 100).toFixed(2),
      type: 'debit',
      status: tx.status || 'completed',
      reference: tx.stripePaymentIntentId,
      createdAt: tx.createdAt,
      label: 'Cart Payment',
    }));

    const merged = [...walletNormalized, ...cartNormalized]
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 50);

    return NextResponse.json({
      success: true,
      transactions: merged,
    });
  } catch (error: any) {
    console.error('Wallet transactions error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}