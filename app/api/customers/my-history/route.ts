import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getSessionFromCookies } from "@/lib/auth"; // Uses your existing auth helper

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

    // 2. Fetch their transactions
    const transactions = await (prisma as any).transaction.findMany({
      where: { 
        session: { customerId: customer.id } 
      },
      include: {
        session: {
          include: {
            items: { include: { product: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 20 // Show last 20 trips
    });

    // 3. Group duplicate items and format the response
    const history = transactions.map((t: any) => {
      const groupedItems: any = {};
      
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

    // Filter out any empty transactions
    const validHistory = history.filter((h: any) => h.items.length > 0);

    return NextResponse.json({ success: true, history: validHistory });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}