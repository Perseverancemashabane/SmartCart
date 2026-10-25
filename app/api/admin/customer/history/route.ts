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
      orderBy: { createdAt: "desc" },
      take: 10 
    });

    // Format and group items
    const history = transactions.map((t: any) => {
      const groupedItems: any = {};
      
      // Group items by product name and sum the quantities
      t.session.items.forEach((item: any) => {
        const name = item.product ? item.product.name : "Unknown";
        if (!groupedItems[name]) {
          groupedItems[name] = { name, quantity: 0 };
        }
        groupedItems[name].quantity += item.quantity;
      });

      return {
        id: t.id,
        date: t.createdAt,
        totalCents: t.amountCents,
        items: Object.values(groupedItems)
      };
    });

    // Filter out any transactions that somehow have 0 items
    const validHistory = history.filter((h: any) => h.items.length > 0);

    return NextResponse.json({ success: true, history: validHistory });
  } catch (err: any) {
    console.error("[customer/history] failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}