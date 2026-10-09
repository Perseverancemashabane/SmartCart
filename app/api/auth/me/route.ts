import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: session.customerId },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        name: true,
        walletBalanceCents: true,
        createdAt: true,
      },
    });

    if (!customer) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    return NextResponse.json({
      authenticated: true,
      customer: {
        ...customer,
        walletBalanceRands: (customer.walletBalanceCents / 100).toFixed(2),
      },
    });
  } catch (error: any) {
    console.error('Me error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}