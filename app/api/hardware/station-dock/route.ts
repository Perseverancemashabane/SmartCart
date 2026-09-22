import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { cartEventsBus } from '@/lib/events';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { station_id, cart_rfid_tag } = body;

    if (!cart_rfid_tag) {
      return NextResponse.json({ error: 'cart_rfid_tag is required' }, { status: 400 });
    }

    // Lookup Cart by stationRfidTag or direct cart ID
    let cart = await prisma.cart.findFirst({
      where: {
        OR: [
          { stationRfidTag: cart_rfid_tag },
          { id: cart_rfid_tag },
        ],
      },
    });

    if (!cart) {
      // Fallback: auto-create if new tag
      cart = await prisma.cart.create({
        data: {
          id: cart_rfid_tag,
          stationRfidTag: cart_rfid_tag,
          status: 'docked',
          lastDockedAt: new Date(),
        },
      });
    } else {
      cart = await prisma.cart.update({
        where: { id: cart.id },
        data: {
          status: 'docked',
          lastDockedAt: new Date(),
        },
      });
    }

    // Lookup active session
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
        message: `Cart ${cart.id} docked, but no active shopping session exists`,
        cartId: cart.id,
      });
    }

    // Update session docking status to true
    const updatedSession = await prisma.cartSession.update({
      where: { id: session.id },
      data: { isDocked: true },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    // Formatted payload for real-time SSE stream listeners
    const streamPayload = {
      event: 'station_docked',
      stationId: station_id || 'STATION_BASE_01',
      cartId: cart.id,
      sessionId: updatedSession.id,
      isDocked: true,
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

    // Emit live SSE update event
    cartEventsBus.emit(`stream:${cart.id}`, streamPayload);

    return NextResponse.json({
      success: true,
      message: `Cart ${cart.id} successfully docked at Base Station ${station_id || '01'}`,
      cartId: cart.id,
      session: streamPayload,
    });
  } catch (error: any) {
    console.error('Error in /api/hardware/station-dock:', error);
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 });
  }
}
