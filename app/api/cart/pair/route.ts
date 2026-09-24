import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    // Upsert physical Cart record
    const cart = await prisma.cart.upsert({
      where: { id: cart_id },
      update: { status: 'active' },
      create: {
        id: cart_id,
        stationRfidTag: `STATION_TAG_${cart_id}`,
        status: 'active',
      },
    });

    // Check for an active session or create a new one
    let activeSession = await prisma.cartSession.findFirst({
      where: { cartId: cart.id, isActive: true },
      include: {
        items: {
          include: { product: true },
        },
      },
    });
        // When re-pairing, always undock the cart
    if (activeSession && activeSession.isDocked) {
      activeSession = await prisma.cartSession.update({
        where: { id: activeSession.id },
        data: { isDocked: false },
        include: {
          items: {
            include: { product: true },
          },
        },
      });
    }

    if (!activeSession) {
      activeSession = await prisma.cartSession.create({
        data: {
          cartId: cart.id,
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
    }

    return NextResponse.json({
      success: true,
      cartId: cart.id,
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
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 });
  }
}
