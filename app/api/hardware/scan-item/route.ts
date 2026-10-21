import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cart_id, rfid_tag, action } = body;

    // 1. Find the product by RFID tag
    const productTag = await (prisma as any).productTag.findFirst({
      where: { rfidTagId: rfid_tag }, 
      include: { product: true },
    });

    if (!productTag || !productTag.product) {
      return NextResponse.json({ error: "Product not found for this tag" }, { status: 404 });
    }

    const product = productTag.product;

    // 2. Find the Cart and Session
    const cart = await (prisma as any).cart.findUnique({ where: { id: cart_id } });
    const session = await (prisma as any).cartSession.findFirst({
      where: { cartId: cart.id, isActive: true },
      include: { items: true },
    });

    if (!session) return NextResponse.json({ error: "No active session" }, { status: 404 });

    const existingItem = session.items.find((i: any) => i.productId === product.id);

    // 3. Create or Update the Cart Item
    // We use a try/catch here specifically to catch the Prisma field error
    try {
      if (existingItem) {
        await (prisma as any).cartItem.update({
          where: { id: existingItem.id },
          data: { 
            quantity: { increment: 1 },
            subtotalCents: { increment: (product.priceCents || 0) } 
          },
        });
      } else {
        await (prisma as any).cartItem.create({
          data: {
            sessionId: session.id,
            productId: product.id,
            // We removed unitPriceCents and name, let's see if it passes
            quantity: 1,
            subtotalCents: (product.priceCents || 0),
          },
        });
      }
    } catch (prismaError: any) {
      // IF IT FAILS, RETURN THE EXACT PRISMA ERROR AS JSON
      return NextResponse.json({ 
        error: "Prisma Error on CartItem", 
        detail: prismaError.message 
      }, { status: 500 });
    }

    // 4. Update Stock
    await (prisma as any).product.update({
      where: { id: product.id },
      data: { stock: { decrement: 1 } },
    });

    // 5. Calculate Totals based on the items array
    const updatedSession = await (prisma as any).cartSession.findUnique({
      where: { id: session.id },
      include: { items: { include: { product: true } } },
    });

    const subtotalCents = updatedSession.items.reduce((sum: number, item: any) => sum + (item.subtotalCents || 0), 0);
    const totalCents = subtotalCents + Math.round(subtotalCents * 0.15);

    await (prisma as any).cartSession.update({
      where: { id: session.id },
      data: { subtotalCents, totalCents },
    });

    return NextResponse.json({
      success: true,
      session: {
        isDocked: cart.status === "docked" || false,
        paymentStatus: "unpaid",
        subtotalCents,
        totalCents,
        items: updatedSession.items.map((i: any) => ({ name: i.product.name, quantity: i.quantity })),
      },
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Server Error", detail: String(err) }, { status: 500 });
  }
}