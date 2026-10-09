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

    const customer = await prisma.customer.findUnique({
      where: { id: session.customerId },
      select: {
        id: true,
        walletBalanceCents: true,
      },
    });

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      balanceCents: customer.walletBalanceCents,
      balanceRands: (customer.walletBalanceCents / 100).toFixed(2),
    });
  } catch (error: any) {
    console.error('Wallet balance error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}