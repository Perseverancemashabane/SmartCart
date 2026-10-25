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
    // Find all paid sessions
    const sessions = await (prisma as any).cartSession.findMany({
      where: { paymentStatus: "paid" },
    });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    let dayRevenue = 0, monthRevenue = 0, yearRevenue = 0;

    sessions.forEach((s: any) => {
      // Use createdAt (the schema uses @map("created_at"))
      const sessionDate = s.createdAt ? new Date(s.createdAt) : new Date();
      if (sessionDate >= startOfDay) dayRevenue += s.totalCents || 0;
      if (sessionDate >= startOfMonth) monthRevenue += s.totalCents || 0;
      if (sessionDate >= startOfYear) yearRevenue += s.totalCents || 0;
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