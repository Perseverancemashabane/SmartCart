import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    // READ-ONLY: Just fetch the state, don't modify anything
    const activeSession = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
      include: {
        items: {
          include: {
            product: {
              include: {
                tags: {
                  where: { isActive: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!activeSession) {
      return NextResponse.json({
        success: true,
        cartId: cart_id,
        session: null,
      });
    }

    return NextResponse.json({
      success: true,
      cartId: cart_id,
      session: {
        id: activeSession.id,
        isActive: activeSession.isActive,
        isDocked: activeSession.isDocked,
        // NEW: payment-related fields the cart uses for gating
        paymentStatus: activeSession.paymentStatus,
        paymentRequestedAt: activeSession.paymentRequestedAt
          ? activeSession.paymentRequestedAt.toISOString()
          : null,
        cartAbandoned: activeSession.cartAbandoned,
        alarmTriggered: activeSession.alarmTriggered,
        subtotalCents: activeSession.subtotalCents,
        taxCents: activeSession.taxCents,
        totalCents: activeSession.totalCents,
        items: activeSession.items.map((item) => ({
          id: item.id,
          sku: item.product.id.toString(),
          name: item.product.name,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
          subtotalCents: item.subtotalCents,
          removeRequestedAt: item.removeRequestedAt
            ? item.removeRequestedAt.toISOString()
            : null,
          confirmedByWatcher: item.confirmedByWatcher,
        })),
      },
    });
  } catch (error: any) {
    console.error('Error in /api/cart/sync:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}