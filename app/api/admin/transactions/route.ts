import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const { limit = 50 } = body || {};

    const transactions = await prisma.walletTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        customer: {
          select: { id: true, name: true, phoneNumber: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      transactions: transactions.map(t => ({
        id: t.id,
        customerName: t.customer?.name ?? '(unknown)',
        phoneNumber: t.customer?.phoneNumber ?? '',
        amountCents: t.amountCents,
        amountRands: (t.amountCents / 100).toFixed(2),
        type: t.type,
        status: t.status,
        reference: t.reference,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error('Transactions error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}