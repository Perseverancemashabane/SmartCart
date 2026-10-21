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
    if (!cart) return NextResponse.json({ error: "Cart not found" }, { status: 404 });

    const session = await (prisma as any).cartSession.findFirst({
      where: { cartId: cart.id, isActive: true },
      include: { items: true },
    });

    if (!session) return NextResponse.json({ error: "No active session" }, { status: 404 });

    const existingItem = session.items.find((i: any) => i.productId === product.id);

    // 3. Create or Update the Cart Item
    if (existingItem) {
      if (action === "toggle" || action === "remove") {
        // Remove the item completely
        await (prisma as any).cartItem.delete({ where: { id: existingItem.id } });
        await (prisma as any).product.update({
          where: { id: product.id },
          data: { stock: { increment: existingItem.quantity } },
        });
      } else {
        // Add another one
        await (prisma as any).cartItem.update({
          where: { id: existingItem.id },
          data: { 
            quantity: { increment: 1 },
            subtotalCents: { increment: (product.priceCents || 0) } 
          },
        });
        await (prisma as any).product.update({
          where: { id: product.id },
          data: { stock: { decrement: 1 } },
        });
      }
    } else {
      if (product.stock <= 0) {
        return NextResponse.json({ error: "Out of stock" }, { status: 400 });
      }

      // Add new item to cart
      await (prisma as any).cartItem.create({
        data: {
          sessionId: session.id,
          productId: product.id,
          quantity: 1,
          subtotalCents: (product.priceCents || 0),
        },
      });

      await (prisma as any).product.update({
        where: { id: product.id },
        data: { stock: { decrement: 1 } },
      });
    }

    // 4. Recalculate Session Totals
    const updatedSession = await (prisma as any).cartSession.findUnique({
      where: { id: session.id },
      include: { items: { include: { product: true } } },
    });

    const subtotalCents = updatedSession.items.reduce((sum: number, item: any) => sum + (item.subtotalCents || 0), 0);
    const taxCents = Math.round(subtotalCents * 0.15);
    const totalCents = subtotalCents + taxCents;

    await (prisma as any).cartSession.update({
      where: { id: session.id },
      data: { subtotalCents, taxCents, totalCents },
    });

    // 5. Return exactly what the ESP32 expects
    return NextResponse.json({
      success: true,
      session: {
        isDocked: cart.status === "docked" || false,
        paymentStatus: updatedSession.paymentStatus || "unpaid",
        subtotalCents,
        taxCents,
        totalCents,
        items: updatedSession.items.map((i: any) => ({ 
          name: i.product.name, 
          quantity: i.quantity 
        })),
      },
    });

  } catch (err: any) {
    console.error("[scan-item] failed:", err);
    return NextResponse.json({ error: "Scan failed", detail: String(err) }, { status: 500 });
  }
}