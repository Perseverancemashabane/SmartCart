import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

/**
 * POST /api/shopping-list/complete
 * Marks the customer's active shopping list as completed and archived.
 * Called after a successful payment (or manually by the customer).
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const activeList = await prisma.shoppingList.findFirst({
      where: { customerId: session.customerId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeList) {
      return NextResponse.json({
        success: true,
        message: 'No active list to complete',
        completedList: null,
      });
    }

    const completed = await prisma.shoppingList.update({
      where: { id: activeList.id },
      data: {
        isActive: false,
        completedAt: new Date(),
      },
      include: {
        items: true,
      },
    });

    const total = completed.items.length;
    const found = completed.items.filter(i => i.isScanned).length;

    return NextResponse.json({
      success: true,
      message: 'Shopping list completed',
      completedList: {
        id: completed.id,
        name: completed.name,
        completedAt: completed.completedAt,
        total,
        found,
        remaining: total - found,
      },
    });
  } catch (error: any) {
    console.error('Shopping list complete error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}