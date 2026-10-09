import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id, cart_rfid_tag } = body;
    const cartId = cart_id || cart_rfid_tag;

    if (!cartId) {
      return NextResponse.json(
        { error: 'cart_id is required' },
        { status: 400 }
      );
    }

    const activeSession = await prisma.cartSession.findFirst({
      where: { cartId: cartId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeSession) {
      return NextResponse.json(
        { error: 'No active session for this cart' },
        { status: 404 }
      );
    }

    const updated = await prisma.cartSession.update({
      where: { id: activeSession.id },
      data: { isDocked: false },
      include: {
        items: { include: { product: true } },
      },
    });

    return NextResponse.json({
      success: true,
      message: `Cart ${cartId} undocked`,
      cartId: cartId,
      session: {
        event: 'station_undocked',
        cartId: cartId,
        sessionId: updated.id,
        isDocked: updated.isDocked,
        subtotalCents: updated.subtotalCents,
        taxCents: updated.taxCents,
        totalCents: updated.totalCents,
        items: updated.items.map((item) => ({
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
    console.error('Error in /api/hardware/station-undock:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}