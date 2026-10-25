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
    const sessions = await (prisma as any).cartSession.findMany({
      where: { 
        customerId: parseInt(customerId) 
      },
      include: {
        items: { include: { product: true } },
      },
      orderBy: { id: "desc" },
      take: 10 
    });

    return NextResponse.json({ success: true, history: sessions });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}