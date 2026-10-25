import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function GET(req: NextRequest) {
  const adminPin = req.headers.get("x-admin-pin");
  if (adminPin !== "9999") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // 1. Fetch ALL sessions that are not 'unpaid'
    const sessions = await (prisma as any).cartSession.findMany({
      where: { 
        OR: [
          { paymentStatus: "paid" },
          { paymentStatus: "completed" }
        ]
      },
    });

    // 2. Fetch ALL successful wallet transactions
    const transactions = await (prisma as any).transaction.findMany({
      where: { status: "completed" } // Adjust if your wallet uses a different status
    });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    let dayRevenue = 0, monthRevenue = 0, yearRevenue = 0;

    // Helper function to add revenue based on date
    const addRevenue = (dateStr: any, amount: number) => {
      if (!dateStr) return;
      const date = new Date(dateStr);
      if (date >= startOfDay) dayRevenue += amount;
      if (date >= startOfMonth) monthRevenue += amount;
      if (date >= startOfYear) yearRevenue += amount;
    };

    // Add up sessions
    sessions.forEach((s: any) => {
      addRevenue(s.createdAt, s.totalCents || 0);
    });

    // Add up transactions (in case they aren't in the sessions)
    transactions.forEach((t: any) => {
      addRevenue(t.createdAt, t.amountCents || 0);
    });

    return NextResponse.json({
      success: true,
      revenue: { 
        day: dayRevenue / 100, 
        month: monthRevenue / 100, 
        year: yearRevenue / 100 
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}