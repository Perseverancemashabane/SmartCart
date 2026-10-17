// app/api/watcher/list/add/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
// 👇 PASTE THE EXACT IMPORT LINE FROM YOUR state/route.ts HERE 👇
import { getCustomer } from "@/lib/auth"; 

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // 👇 USE THE EXACT SAME AUTH FUNCTION YOUR WORKING ROUTE USES 👇
    // (If your working route uses something other than getCustomer(req), change it here)
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

    // 1. Find or create the active list for THIS customer
    let list = await prisma.shoppingList.findFirst({
      where: { customerId: customer.id, isActive: true },
    });

    if (!list) {
      list = await prisma.shoppingList.create({
        data: { customerId: customer.id, isActive: true },
      });
    }

    // 2. Create the item
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