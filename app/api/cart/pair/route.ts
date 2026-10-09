import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    // ============================================================
    // 1. Require login — no anonymous cart access
    // ============================================================
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated. Please log in to pair a cart.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    // ============================================================
    // 2. Upsert physical Cart record
    // ============================================================
    const cart = await prisma.cart.upsert({
      where: { id: cart_id },
      update: { status: 'active' },
      create: {
        id: cart_id,
        stationRfidTag: `STATION_TAG_${cart_id}`,
        status: 'active',
      },
    });

    // ============================================================
    // 3. Check for an active session for this cart
    //    If one exists but belongs to a DIFFERENT customer, close it
    // ============================================================
    let activeSession = await prisma.cartSession.findFirst({
      where: { cartId: cart.id, isActive: true },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (activeSession && activeSession.customerId !== session.customerId) {
      // Someone else's stale session — close it
      console.log(
        `[Pair] Closing stale session ${activeSession.id} (was customer ${activeSession.customerId}, now ${session.customerId})`
      );
      await prisma.cartSession.update({
        where: { id: activeSession.id },
        data: { isActive: false, closedAt: new Date() },
      });
      activeSession = null;
    }

    // ============================================================
    // 4. If no active session, create a fresh one for THIS customer
    // ============================================================
    if (!activeSession) {
      activeSession = await prisma.cartSession.create({
        data: {
          cartId: cart.id,
          customerId: session.customerId,
          isActive: true,
          isDocked: false,
          subtotalCents: 0,
          taxCents: 0,
          totalCents: 0,
        },
        include: {
          items: {
            include: { product: true },
          },
        },
      });
      console.log(
        `[Pair] Created session ${activeSession.id} for cart ${cart.id} → customer ${session.customerId}`
      );
    } else {
      console.log(
        `[Pair] Resuming existing session ${activeSession.id} for cart ${cart.id} → customer ${session.customerId}`
      );
    }

    // ============================================================
    // 5. Return the session state
    // ============================================================
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
        items: activeSession.items.map((item) => ({
          id: item.id,
          sku: item.product.rfidTagId,
          name: item.product.name,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
          subtotalCents: item.subtotalCents,
        })),
      },
    });
  } catch (error: any) {
    console.error('Error in /api/cart/pair:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}