import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function POST(req: NextRequest) {
  const adminPin = req.headers.get("x-admin-pin");
  if (adminPin !== "9999") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Fetch the actual Cart Sessions that were paid
    const sessions = await (prisma as any).cartSession.findMany({
      where: {
        OR: [
          { paymentStatus: "paid" },
          { paymentStatus: "completed" },
          { paymentStatus: "success" }
        ]
      },
      include: {
        customer: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    // Format them for the frontend
    const transactions = sessions.map((s: any) => ({
      id: s.id,
      createdAt: s.createdAt,
      customerName: s.customer?.name || "Guest",
      phoneNumber: s.customer?.phoneNumber || "—",
      amountRands: (s.totalCents / 100).toFixed(2),
      type: "Shopping Trip",
      status: s.paymentStatus
    }));

    return NextResponse.json({ success: true, transactions });
  } catch (err: any) {
    console.error("[admin/transactions] failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}