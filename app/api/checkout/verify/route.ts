import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { reference } = body;

    if (!reference) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 });
    }

    // 1. Verify with Paystack
    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== "success") {
      return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
    }

    // 2. Find the session via metadata
    const cartId = paystackData.data.metadata?.cart_id;
    if (!cartId) {
      return NextResponse.json({ error: "Missing cart_id in metadata" }, { status: 400 });
    }

    const cart = await (prisma as any).cart.findUnique({ where: { id: cartId } });
    if (!cart) return NextResponse.json({ error: "Cart not found" }, { status: 404 });

    const session = await (prisma as any).cartSession.findFirst({
      where: { cartId: cart.id, isActive: true },
      include: { items: true }
    });

    // 3. Mark as PAID and CLOSE the session
    if (session) {
      await (prisma as any).cartSession.update({
        where: { id: session.id },
        data: { 
          paymentStatus: "paid",
          isActive: false,
          closedAt: new Date()
        }
      });
    }

    // 4. Use UPSERT so it doesn't crash if the webhook/redirect fires twice
    const existingTransaction = await (prisma as any).transaction.findFirst({
      where: { stripePaymentIntentId: reference }
    });

    if (!existingTransaction) {
      await (prisma as any).transaction.create({
        data: {
          sessionId: session ? session.id : 0, 
          stripePaymentIntentId: reference, 
          amountCents: paystackData.data.amount,
          currency: "ZAR",
          status: "completed",
        }
      });
    }

    return NextResponse.json({ 
      success: true, 
      amountRands: (paystackData.data.amount / 100).toFixed(2) 
    });

  } catch (err: any) {
    console.error("[checkout/verify] failed:", err);
    return NextResponse.json({ error: String(err), detail: err.message }, { status: 500 });
  }
}