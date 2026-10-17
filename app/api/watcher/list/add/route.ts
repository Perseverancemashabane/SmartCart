// app/api/watcher/list/add/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCustomer } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // 1. Use your existing auth helper instead of guessing the session table name
    const customer = await getCustomer(req);
    if (!customer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    const name = String(body.name ?? "").trim();
    const qtyParsed = parseInt(body.quantity, 10);
    const quantity = Number.isFinite(qtyParsed) && qtyParsed > 0 ? qtyParsed : 1;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // 2. Find or create the active ShoppingList
    let list = await prisma.shoppingList.findFirst({
      where: { customerId: customer.id, isActive: true },
    });

    if (!list) {
      list = await prisma.shoppingList.create({
        data: { customerId: customer.id, isActive: true },
      });
    }

    // 3. Create the item
    const item = await prisma.shoppingListItem.create({
      data: {
        listId: list.id,
        name,
        quantity,
        isScanned: false,
      },
    });

    return NextResponse.json({ success: true, item });
  } catch (err: any) {
    console.error("[watcher/list/add] failed:", err);
    return NextResponse.json(
      { error: "Failed to add item", detail: String(err) },
      { status: 500 }
    );
  }
}