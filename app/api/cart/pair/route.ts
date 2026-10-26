import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session || !session.customerId) {
      return NextResponse.json({ error: 'Not authenticated. Please log in.' }, { status: 401 });
    }

    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    // 1. Upsert the physical cart
    const cart = await prisma.cart.upsert({
      where: { id: cart_id },
      update: { status: 'active' },
      create: {
        id: cart_id,
        stationRfidTag: `STATION_TAG_${cart_id}`,
        status: 'active',
      },
    });

    // 2. Find an existing active session
    let activeSession = await prisma.cartSession.findFirst({
      where: { cartId: cart.id, isActive: true },
    });

    // 3. If a session exists for a DIFFERENT customer OR if it's already paid, close it
    if (activeSession && (activeSession.customerId !== session.customerId || activeSession.paymentStatus === 'paid')) {
      await prisma.cartSession.update({
        where: { id: activeSession.id },
        data: { isActive: false, closedAt: new Date() },
      });
      activeSession = null;
    }

    // 4. Create a new session if needed
    if (!activeSession) {
      activeSession = await prisma.cartSession.create({
        data: {
          cartId: cart.id,
          customerId: session.customerId,
          isActive: true,
          isDocked: false,
          paymentStatus: 'unpaid',
          subtotalCents: 0,
          taxCents: 0,
          totalCents: 0,
        },
      });
    }

    // 5. Return success
    return NextResponse.json({
      success: true,
      cartId: cart.id,
      customerId: session.customerId,
      session: {
        id: activeSession.id,
        isActive: activeSession.isActive,
        isDocked: activeSession.isDocked,
        subtotalCents: activeSession.subtotalCents,
        taxCents: activeSession.taxCents,
        totalCents: activeSession.totalCents,
        items: [], // Returning empty to prevent relation crashes
      },
    });
  } catch (error: any) {
    console.error('Error in /api/cart/pair:', error);
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 });
  }
}