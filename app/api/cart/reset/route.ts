import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id } = body;

    if (!cart_id) {
      return NextResponse.json({ error: 'cart_id is required' }, { status: 400 });
    }

    console.log(`[Reset] Request received for ${cart_id}`);

    // Find ALL active sessions for this cart (in case there are duplicates)
    const activeSessions = await prisma.cartSession.findMany({
      where: { cartId: cart_id, isActive: true },
    });

    console.log(`[Reset] Found ${activeSessions.length} active session(s)`);

    if (activeSessions.length === 0) {
      return NextResponse.json({
        success: true,
        message: `No active session found for ${cart_id}`,
        cartId: cart_id,
      });
    }

    // Delete ALL items from ALL active sessions
    const deletedItems = await prisma.cartItem.deleteMany({
      where: { sessionId: { in: activeSessions.map(s => s.id) } },
    });

    console.log(`[Reset] Deleted ${deletedItems.count} item(s)`);

    // Close ALL active sessions
    await prisma.cartSession.updateMany({
      where: { id: { in: activeSessions.map(s => s.id) } },
      data: {
        isActive: false,
        isDocked: false,
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
        closedAt: new Date(),
      },
    });

    // Reset cart status
    await prisma.cart.update({
      where: { id: cart_id },
      data: { status: 'available' },
    });

    console.log(`[Reset] Cart ${cart_id} reset successfully`);

    return NextResponse.json({
      success: true,
      message: `Cart ${cart_id} reset successfully`,
      cartId: cart_id,
      itemsDeleted: deletedItems.count,
      sessionsClosed: activeSessions.length,
    });
  } catch (error: any) {
    console.error('Error in /api/cart/reset:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}