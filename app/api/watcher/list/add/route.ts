// app/api/watcher/list/add/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function POST(req: NextRequest) {
  try {
    const cookie = req.cookies.get("smartcart_session")?.value;
    if (!cookie) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await (prisma as any).session.findUnique({
      where: { token: cookie },
      include: { customer: true },
    });
    if (!session || !session.customer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const customer = session.customer;

    const body = await req.json().catch(() => ({} as any));
    const name = String(body.name ?? "").trim();
    const qtyParsed = parseInt(body.quantity, 10);
    const quantity = Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 1;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: "Name too long" }, { status: 400 });
    }

    let list = await (prisma as any).shoppingList.findFirst({
      where: { customerId: customer.id, isActive: true },
    });

    if (!list) {
      list = await (prisma as any).shoppingList.create({
        data: { customerId: customer.id, isActive: true },
      });
    }

    const item = await (prisma as any).shoppingListItem.create({
      data: {
        listId: list.id,
        name,
        quantity,
        isScanned: false,
      },
    });

    return NextResponse.json({ success: true, item });
  } catch (err) {
    console.error("[watcher/list/add] failed:", err);
    return NextResponse.json(
      { error: "Failed to add item", detail: String(err) },
      { status: 500 }
    );
  }
}