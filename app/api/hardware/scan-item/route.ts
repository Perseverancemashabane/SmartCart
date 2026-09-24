import { NextResponse } from 'next/server';
import { cartEventsBus } from '@/lib/events';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id, rfid_tag, action = 'toggle' } = body;

    if (!cart_id || !rfid_tag) {
      return NextResponse.json({ error: 'cart_id and rfid_tag are required' }, { status: 400 });
    }

    const product = await prisma.product.findUnique({
      where: { rfidTagId: rfid_tag },
    });

    if (!product) {
      return NextResponse.json({ error: `Product with RFID tag ${rfid_tag} not found` }, { status: 404 });
    }

    const session = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
    });

    if (!session) {
      return NextResponse.json({ error: `No active session found for cart ${cart_id}` }, { status: 404 });
    }

    // Reject scans while cart is docked
    if (session.isDocked) {
      return NextResponse.json(
        { error: 'Cart is docked at base station. Cannot scan new items.' },
        { status: 403 }
      );
    }

    const existingItem = await prisma.cartItem.findUnique({
      where: {
        sessionId_productId: {
          sessionId: session.id,
          productId: product.id,
        },
      },
    });

    const currentQty = existingItem?.quantity ?? 0;
    let actionTaken = 'none';

    if (action === 'add') {
      if (existingItem) {
        const newQty = currentQty + 1;
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: newQty,
            subtotalCents: newQty * product.priceCents,
          },
        });
        actionTaken = 'incremented';
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
        actionTaken = 'added';
      }
    } else if (action === 'remove') {
      if (existingItem) {
        if (currentQty > 1) {
          const newQty = currentQty - 1;
          await prisma.cartItem.update({
            where: { id: existingItem.id },
            data: {
              quantity: newQty,
              subtotalCents: newQty * product.priceCents,
            },
          });
          actionTaken = 'decremented';
        } else {
          await prisma.cartItem.delete({ where: { id: existingItem.id } });
          actionTaken = 'removed';
        }
      }
    } else {
      // Toggle: if exists, remove; if not, add
      if (existingItem) {
        await prisma.cartItem.delete({ where: { id: existingItem.id } });
        actionTaken = 'removed';
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
        actionTaken = 'added';
      }
    }

    // Recalculate totals
    const allItems = await prisma.cartItem.findMany({
      where: { sessionId: session.id },
      include: { product: true },
    });

    const subtotalCents = allItems.reduce((acc, item) => acc + (item.subtotalCents ?? 0), 0);
    const taxCents = Math.round(subtotalCents * 0.15);
    const totalCents = subtotalCents + taxCents;

    const updatedSession = await prisma.cartSession.update({
      where: { id: session.id },
      data: { subtotalCents, taxCents, totalCents },
      include: { items: { include: { product: true } } },
    });

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
      lastAction: { action: actionTaken, product: product.name, sku: rfid_tag },
    };

    cartEventsBus.emit(`stream:${cart_id}`, streamPayload);

    return NextResponse.json({
      success: true,
      cartId: cart_id,
      session: streamPayload,
    });
  } catch (error: any) {
    console.error('Error in /api/hardware/scan-item:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}