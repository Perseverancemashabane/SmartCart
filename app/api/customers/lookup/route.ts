import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone_number } = body;

    if (!phone_number) {
      return NextResponse.json(
        { error: 'phone_number is required' },
        { status: 400 }
      );
    }

    // Normalize phone number (remove spaces, dashes)
    const normalized = phone_number.replace(/[\s\-\(\)]/g, '');

    const customer = await prisma.customer.findUnique({
      where: { phoneNumber: normalized },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        walletBalanceCents: true,
        createdAt: true,
      },
    });

    if (!customer) {
      return NextResponse.json({
        found: false,
        message: 'Customer not found',
      });
    }

    return NextResponse.json({
      found: true,
      customer: {
        id: customer.id,
        phoneNumber: customer.phoneNumber,
        name: customer.name,
        walletBalanceCents: customer.walletBalanceCents,
        walletBalanceRands: (customer.walletBalanceCents / 100).toFixed(2),
      },
    });
  } catch (error: any) {
    console.error('Customer lookup error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}