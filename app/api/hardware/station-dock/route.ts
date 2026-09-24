import { NextResponse } from 'next/server';
import { cartEventsBus } from '@/lib/events';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { station_id, cart_rfid_tag, action = 'dock' } = body;

    if (!cart_rfid_tag) {
      return NextResponse.json({ error: 'cart_rfid_tag is required' }, { status: 400 });
    }

    const isDocking = action !== 'undock';

    let cart = await prisma.cart.findFirst({
      where: {
        OR: [
          { stationRfidTag: cart_rfid_tag },
          { id: cart_rfid_tag },
        ],
      },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: {
          id: cart_rfid_tag,
          stationRfidTag: cart_rfid_tag,
          status: isDocking ? 'docked' : 'available',
          lastDockedAt: isDocking ? new Date() : null,
        },
      });
    } else {
      cart = await prisma.cart.update({
        where: { id: cart.id },
        data: {
          status: isDocking ? 'docked' : 'active',
          lastDockedAt: isDocking ? new Date() : undefined,
        },
      });
    }

    const session = await prisma.cartSession.findFirst({
      where: { cartId: cart.id, isActive: true },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!session) {
      return NextResponse.json({
        success: true,
        message: `Cart ${cart.id} ${isDocking ? 'docked' : 'undocked'}, but no active session exists`,
        cartId: cart.id,
      });
    }

    const updatedSession = await prisma.cartSession.update({
      where: { id: session.id },
      data: { isDocked: isDocking },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    const streamPayload = {
      event: isDocking ? 'station_docked' : 'station_undocked',
      stationId: station_id || 'STATION_BASE_01',
      cartId: cart.id,
      sessionId: updatedSession.id,
      isDocked: isDocking,
      subtotalCents: updatedSession.subtotalCents,
      taxCents: updatedSession.taxCents,
      totalCents: updatedSession.totalCents,
      items: updatedSession.items.map((i) => ({
        id: i.id,
        sku: i.product.rfidTagId,
        name: i.product.name,
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
        subtotalCents: i.subtotalCents,
      })),
    };

    cartEventsBus.emit(`stream:${cart.id}`, streamPayload);

    return NextResponse.json({
      success: true,
      message: `Cart ${cart.id} successfully ${isDocking ? 'docked at' : 'undocked from'} Base Station ${station_id || '01'}`,
      cartId: cart.id,
      session: streamPayload,
    });
  } catch (error: any) {
    console.error('Error in /api/hardware/station-dock:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}