import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate the customer
    const customer = await getSessionFromCookies(req);
    if (!customer || !customer.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Fetch successful sessions from the CartSession table
    const sessions = await (prisma as any).cartSession.findMany({
      where: { 
        customerId: customer.id,
        OR: [
          { paymentStatus: "paid" },
          { paymentStatus: "completed" },
          { paymentStatus: "success" }
        ]
      },
      include: {
        items: { include: { product: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20 
    });

    // 3. Format and group items (so two tags of Milk become 2x Milk)
    const history = sessions.map((s: any) => {
      const groupedItems: any = {};
      
      s.items.forEach((item: any) => {
        const name = item.product ? item.product.name : "Unknown Item";
        if (!groupedItems[name]) {
          groupedItems[name] = { name, quantity: 0 };
        }
        groupedItems[name].quantity += item.quantity;
      });

      return {
        id: s.id,
        date: s.createdAt || new Date(),
        totalCents: s.totalCents || 0,
        items: Object.values(groupedItems)
      };
    });

    // Filter out empty ones (just in case)
    const validHistory = history.filter((h: any) => h.items.length > 0);

    return NextResponse.json({ success: true, history: validHistory });
  } catch (err: any) {
    console.error("[my-history] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}