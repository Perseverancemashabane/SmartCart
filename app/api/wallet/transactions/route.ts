import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const transactions = await prisma.walletTransaction.findMany({
      where: { customerId: session.customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        amountCents: tx.amountCents,
        amountRands: (tx.amountCents / 100).toFixed(2),
        type: tx.type,
        status: tx.status,
        reference: tx.reference,
        createdAt: tx.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('Wallet transactions error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}