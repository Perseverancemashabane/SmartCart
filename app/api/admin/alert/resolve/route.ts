import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/adminAuth';
import { cartEventsBus } from '@/lib/events';

/**
 * POST /api/admin/alert/resolve
 * Body: { alertId }
 *
 * Resolves an alert AND calls anti-theft-clear with "continue"
 * to reset the cart session's alarmTriggered flag.
 */
export async function POST(request: Request) {
  try {
    const auth = requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { alertId } = body;

    if (!alertId) {
      return NextResponse.json({ error: 'alertId required' }, { status: 400 });
    }

    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    if (alert.resolvedAt) {
      return NextResponse.json({
        success: true,
        message: 'Alert already resolved',
        alertId,
      });
    }

    // Reset alarmTriggered on the active session for this cart (if any)
    const session = await prisma.cartSession.findFirst({
      where: { cartId: alert.cartId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (session) {
      await prisma.cartSession.update({
        where: { id: session.id },
        data: { alarmTriggered: false },
      });

      cartEventsBus.emit(`stream:${alert.cartId}`, {
        event: 'anti_theft_cleared',
        cartId: alert.cartId,
        sessionId: session.id,
        action: 'continue',
      });
    }

    // Mark alert resolved
    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: auth.name,
        resolution: 'continue',
      },
    });

    return NextResponse.json({
      success: true,
      alertId: updated.id,
      resolvedAt: updated.resolvedAt?.toISOString(),
      resolvedBy: updated.resolvedBy,
    });
  } catch (error: any) {
    console.error('Alert resolve error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}