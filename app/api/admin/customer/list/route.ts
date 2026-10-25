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
    const customers = await (prisma as any).customer.findMany({
      orderBy: { id: "desc" }
    });
    return NextResponse.json({ success: true, customers });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}