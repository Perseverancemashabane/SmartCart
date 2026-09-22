import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { cartEventsBus } from '@/lib/events';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id, rfid_tag, action = 'add' } = body;

    if (!cart_id || !rfid_tag) {
      return NextResponse.json({ error: 'cart_id and rfid_tag are required' }, { status: 400 });
    }

    // Lookup Product by RFID Tag ID
    const product = await prisma.product.findUnique({
      where: { rfidTagId: rfid_tag },
    });

    if (!product) {
      return NextResponse.json({ error: `Product with RFID tag ${rfid_tag} not found` }, { status: 404 });
    }

    // Lookup active CartSession
    const session = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
    });

    if (!session) {
      return NextResponse.json({ error: `No active session found for cart ${cart_id}` }, { status: 404 });
    }

    // Process CartItem addition/removal
    const existingItem = await prisma.cartItem.findUnique({
      where: {
        sessionId_productId: {
          sessionId: session.id,
          productId: product.id,
        },
      },
    });

    if (action === 'add') {
      if (existingItem) {
        const newQty = existingItem.quantity + 1;
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: newQty,
            subtotalCents: newQty * product.priceCents,
          },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            sessionId: session.id,
            productId: product.id,
            quantity: 1,
            unitPriceCents: product.priceCents,
            subtotalCents: product.priceCents,
          },
        });
      }
    } else if (action === 'remove') {
      if (existingItem) {
        if (existingItem.quantity > 1) {
          const newQty = existingItem.quantity - 1;
          await prisma.cartItem.update({
            where: { id: existingItem.id },
            data: {
              quantity: newQty,
              subtotalCents: newQty * product.priceCents,
            },
          });
        } else {
          await prisma.cartItem.delete({
            where: { id: existingItem.id },
          });
        }
      }
    }

    // Recalculate session totals
    const allItems = await prisma.cartItem.findMany({
      where: { sessionId: session.id },
      include: { product: true },
    });

    const subtotalCents = allItems.reduce((acc, item) => acc + item.subtotalCents, 0);
    const taxCents = Math.round(subtotalCents * 0.15); // 15% VAT
    const totalCents = subtotalCents + taxCents;

    const updatedSession = await prisma.cartSession.update({
      where: { id: session.id },
      data: {
        subtotalCents,
        taxCents,
        totalCents,
      },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    // Formatted payload for real-time SSE stream listeners
    const streamPayload = {
      event: 'cart_updated',
      cartId: cart_id,
      sessionId: updatedSession.id,
      isDocked: updatedSession.isDocked,
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
      lastAction: { action, product: product.name, sku: rfid_tag },
    };

    // Emit live SSE update event
    cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

    return NextResponse.json({
      success: true,
      cartId: cart_id,
      session: streamPayload,
    });
  } catch (error: any) {
    console.error('Error in /api/hardware/scan-item:', error);
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 });
  }
}
