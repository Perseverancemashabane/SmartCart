import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/shopping-list/create
 * Creates a new active shopping list for the current customer.
 * If an active list already exists, it's marked as inactive
 * and archived (so history is preserved) before the new one is created.
 *
 * Body: { name?: string }   // optional list name, defaults to date
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { name } = body || {};

    // Archive any currently active lists for this customer
    const now = new Date();
    const archived = await prisma.shoppingList.updateMany({
      where: {
        customerId: session.customerId,
        isActive: true,
      },
      data: {
        isActive: false,
        completedAt: now,
      },
    });

    if (archived.count > 0) {
      console.log(`[ShoppingList] Archived ${archived.count} previous active list(s)`);
    }

    // Create a fresh active list
    const list = await prisma.shoppingList.create({
      data: {
        customerId: session.customerId,
        name: name || `Shopping Trip ${now.toLocaleDateString('en-ZA')}`,
        isActive: true,
      },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    console.log(`[ShoppingList] Created list ${list.id} for customer ${session.customerId}`);

    return NextResponse.json({
      success: true,
      list: {
        id: list.id,
        name: list.name,
        isActive: list.isActive,
        createdAt: list.createdAt,
        items: [],
      },
    });
  } catch (error: any) {
    console.error('Shopping list create error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}