// app/api/hardware/scan-item/route.ts
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

    if (!cart_id || !rfid_tag) {
      return NextResponse.json({ error: "Missing cart_id or rfid_tag" }, { status: 400 });
    }

    // 1. Find the product by RFID tag
    const productTag = await (prisma as any).productTag.findFirst({
      where: { tag: rfid_tag },
      include: { product: true },
    });

    if (!productTag || !productTag.product) {
      return NextResponse.json({ error: "Product not found for this tag" }, { status: 404 });
    }

    const product = productTag.product;

    // 2. Find the active cart
    const cart = await (prisma as any).cart.findFirst({
      where: { cartCode: cart_id },
      include: { items: true },
    });

    if (!cart) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }

    // 3. Check if item is already in the cart
    const existingItem = cart.items.find((i: any) => i.productId === product.id);

    if (existingItem) {
      // If action is "toggle" and they scan again, we remove it (and give stock back)
      if (action === "toggle" || action === "remove") {
        await (prisma as any).cartItem.delete({ where: { id: existingItem.id } });
        
        // Give stock back
        await (prisma as any).product.update({
          where: { id: product.id },
          data: { stock: { increment: existingItem.quantity } },
        });
      } else {
        // Increment quantity
        await (prisma as any).cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: { increment: 1 } },
        });
        
        // Decrease stock
        await (prisma as any).product.update({
          where: { id: product.id },
          data: { stock: { decrement: 1 } },
        });
      }
    } else {
      // 4. Item is not in cart, add it and decrease stock
      if (product.stock <= 0) {
        return NextResponse.json({ error: "Out of stock" }, { status: 400 });
      }

      await (prisma as any).cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          name: product.name,
          unitPriceCents: product.priceCents,
          quantity: 1,
        },
      });

      // Decrease stock
      await (prisma as any).product.update({
        where: { id: product.id },
        data: { stock: { decrement: 1 } },
      });
    }

    // 5. Recalculate Cart Totals
    const updatedCart = await (prisma as any).cart.findUnique({
      where: { id: cart.id },
      include: { items: true },
    });

    const subtotalCents = updatedCart.items.reduce((sum: number, item: any) => sum + (item.unitPriceCents * item.quantity), 0);
    const taxCents = Math.round(subtotalCents * 0.15); // Assuming 15% VAT, change if different
    const totalCents = subtotalCents + taxCents;

    await (prisma as any).cart.update({
      where: { id: cart.id },
      data: { subtotalCents, taxCents, totalCents },
    });

    // 6. Return the new session to the ESP32
    return NextResponse.json({
      success: true,
      session: {
        isDocked: updatedCart.isDocked,
        paymentStatus: updatedCart.paymentStatus,
        subtotalCents,
        taxCents,
        totalCents,
        items: updatedCart.items.map((i: any) => ({ name: i.name, quantity: i.quantity })),
      },
    });

  } catch (err: any) {
    console.error("[scan-item] failed:", err);
    return NextResponse.json({ error: "Scan failed", detail: String(err) }, { status: 500 });
  }
}