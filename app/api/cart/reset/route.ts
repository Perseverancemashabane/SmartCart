import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    // Find the active session for this cart
    const session = await prisma.cartSession.findFirst({
      where: { cartId: cart_id, isActive: true },
    });

    if (!session) {
      // Nothing to reset — return success anyway (idempotent)
      return NextResponse.json({
        success: true,
        message: `No active session found for ${cart_id}`,
        cartId: cart_id,
      });
    }

    // Delete all items in this session
    await prisma.cartItem.deleteMany({
      where: { sessionId: session.id },
    });

    // Close the session
    await prisma.cartSession.update({
      where: { id: session.id },
      data: {
        isActive: false,
        isDocked: false,
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
        closedAt: new Date(),
      },
    });

    // Reset the cart status
    await prisma.cart.update({
      where: { id: cart_id },
      data: { status: 'available' },
    });

    return NextResponse.json({
      success: true,
      message: `Cart ${cart_id} reset successfully`,
      cartId: cart_id,
    });
  } catch (error: any) {
    console.error('Error in /api/cart/reset:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}