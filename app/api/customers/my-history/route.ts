import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    // 1. Get the session using the exact same method as your working routes
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session || !session.customerId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // 2. Fetch the sessions for this customer
    const sessions = await prisma.cartSession.findMany({
      where: { 
        customerId: session.customerId 
      },
      include: {
        items: {
          include: { product: true }
        }
      },
      orderBy: { id: "desc" },
      take: 20 
    });

    // 3. Format the data
    const history = sessions.map((s: any) => {
      const groupedItems: any = {};
      
      (s.items || []).forEach((item: any) => {
        const name = item.product ? item.product.name : "Unknown Item";
        if (!groupedItems[name]) {
          groupedItems[name] = { name, quantity: 0 };
        }
        groupedItems[name].quantity += item.quantity;
      });

      return {
        id: s.id,
        date: s.createdAt || new Date(),
        totalCents: s.totalCents || 0,
        status: s.paymentStatus || "unpaid",
        items: Object.values(groupedItems)
      };
    });

    return NextResponse.json({ success: true, history });
  } catch (error: any) {
    console.error('Error in /api/customers/my-history:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}