import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate
    const customer = await getSessionFromCookies(req);
    if (!customer || !customer.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Fetch sessions for this customer
    const sessions = await (prisma as any).cartSession.findMany({
      where: { 
        customerId: customer.id 
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: { id: "desc" },
      take: 20 
    });

    // 3. Format the data for the frontend
    const history = sessions.map((s: any) => {
      const groupedItems: any = {};
      
      // Group items (so 2x Milk becomes one line)
      (s.items || []).forEach((item: any) => {
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
        status: s.paymentStatus || "unpaid",
        items: Object.values(groupedItems)
      };
    });

    return NextResponse.json({ success: true, history });
  } catch (err: any) {
    console.error("[my-history] failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}