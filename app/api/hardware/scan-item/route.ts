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

    // FIX: We use the `sku` field (which exists on your DB, as seen in earlier logs)
    // If it doesn't exist, we use the `name` field with the tag attached.
    // We will check if a cart item has this EXACT tag.
    const existingItem = session.items.find((i: any) => {
      // If the database has an `sku` field, check it.
      if (i.sku === rfid_tag) return true;
      // Fallback: check if the name contains the tag (e.g., "Milk (E3087506)")
      if (i.name && i.name.includes(rfid_tag)) return true;
      return false;
    });

    // 3. Create or Update the Cart Item
    if (existingItem) {
      // Same tag scanned again -> remove it
      await (prisma as any).cartItem.delete({ where: { id: existingItem.id } });
      
      await (prisma as any).product.update({
        where: { id: product.id },
        data: { stockQuantity: { increment: existingItem.quantity } },
      });
    } else {
      if (product.stockQuantity !== null && product.stockQuantity <= 0) {
        return NextResponse.json({ success: false, error: "Out of stock" }, { status: 400 });
      }

      // We save the product name + tag so the system can distinguish tags
      const itemName = `${product.name} (${rfid_tag})`;

      await (prisma as any).cartItem.create({
        data: {
          sessionId: session.id,
          productId: product.id,
          name: itemName, // <--- We use the name field to track the tag
          quantity: 1,
          unitPriceCents: (product.priceCents || 0),
          subtotalCents: (product.priceCents || 0),
        },
      });

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
    // We strip the tag out of the name before sending it to the screen
    return NextResponse.json({
      success: true,
      session: {
        isDocked: cart.status === "docked" || false,
        paymentStatus: updatedSession.paymentStatus || "unpaid",
        subtotalCents,
        taxCents,
        totalCents,
        items: updatedSession.items.map((i: any) => {
          // Clean the name by removing the tag parentheses for the TFT screen
          let cleanName = i.name || i.product.name;
          if (cleanName.includes(" (")) {
            cleanName = cleanName.split(" (")[0];
          }
          return { 
            name: cleanName, 
            quantity: i.quantity 
          };
        }),
      },
    });

  } catch (err: any) {
    console.error("[scan-item] failed:", err);
    return NextResponse.json({ success: false, error: "Scan failed", detail: String(err) }, { status: 500 });
  }
}