import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Force close any active sessions for cart_004
    await prisma.cartSession.updateMany({
      where: { cartId: 'cart_004', isActive: true },
      data: { isActive: false, closedAt: new Date() },
    });
    return NextResponse.json({ success: true, message: "Cart sessions cleared" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}