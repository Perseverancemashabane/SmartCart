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
      return NextResponse.json({ success: false, error: "Product not found" }, { status: 404 });
    }

    const product = productTag.product;

    // 2. Find the Cart and Session
    const cart = await (prisma as any).cart.findUnique({ where: { id: cart_id } });
    if (!cart) return NextResponse.json({ success: false, error: "Cart not found" }, { status: 404 });

    const session = await (prisma as any).cartSession.findFirst({
      where: { cartId: cart.id, isActive: true },
      include: { items: true },
    });

    if (!session) return NextResponse.json({ success: false, error: "No active session" }, { status: 404 });

    // FIX: Find the item by the specific RFID tag (saved in the `sku` field), not just the productId
    const existingItem = session.items.find((i: any) => i.sku === rfid_tag);

    // 3. Create or Update the Cart Item
    if (existingItem) {
      // If the SAME tag is scanned twice, remove it
      await (prisma as any).cartItem.delete({ where: { id: existingItem.id } });
      
      // Give stock back
      await (prisma as any).product.update({
        where: { id: product.id },
        data: { stockQuantity: { increment: existingItem.quantity } },
      });
    } else {
      // Check stock
      if (product.stockQuantity !== null && product.stockQuantity <= 0) {
        return NextResponse.json({ success: false, error: "Out of stock" }, { status: 400 });
      }

      // Add the new item, saving the rfid_tag in the `sku` field so we know which tag it is
      await (prisma as any).cartItem.create({
        data: {
          sessionId: session.id,
          productId: product.id,
          sku: rfid_tag, // <--- SAVE THE SPECIFIC TAG HERE
          quantity: 1,
          unitPriceCents: (product.priceCents || 0),
          subtotalCents: (product.priceCents || 0),
        },
      });

      // Decrease stock
      await (prisma as any).product.update({
        where: { id: product.id },
        data: { stockQuantity: { decrement: 1 } },
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

    // 5. Return EXACTLY what the ESP32 v19 code expects
    return NextResponse.json({
      success: true,
      session: {
        isDocked: cart.status === "docked" || false,
        paymentStatus: updatedSession.paymentStatus || "unpaid",
        subtotalCents,
        taxCents,
        totalCents,
        // We return the product name for each item, so the screen shows "Milk" twice if two tags are scanned
        items: updatedSession.items.map((i: any) => ({ 
          name: i.product.name, 
          quantity: i.quantity 
        })),
      },
    });

  } catch (err: any) {
    console.error("[scan-item] failed:", err);
    return NextResponse.json({ success: false, error: "Scan failed", detail: String(err) }, { status: 500 });
  }
}