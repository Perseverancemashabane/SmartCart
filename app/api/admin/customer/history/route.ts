import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function GET(req: NextRequest) {
  const adminPin = req.headers.get("x-admin-pin");
  if (adminPin !== "9999") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "Missing customerId" }, { status: 400 });

  try {
    // 1. Fetch transactions for this specific customer
    const transactions = await (prisma as any).transaction.findMany({
      where: { 
        session: { customerId: parseInt(customerId) } 
      },
      include: {
        session: {
          include: {
            items: { include: { product: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" }, // Most recent first
      take: 10 // Only the last 10
    });

    // 2. Format them so the frontend can read them easily
    const history = transactions.map((t: any) => ({
      id: t.id,
      date: t.createdAt,
      totalCents: t.amountCents,
      items: t.session.items
    }));

    return NextResponse.json({ success: true, history });
  } catch (err: any) {
    console.error("[customer/history] failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}