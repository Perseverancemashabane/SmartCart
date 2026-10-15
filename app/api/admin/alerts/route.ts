import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/admin/alerts
 *
 * Body: { "includeResolved": false }
 *
 * Returns active alerts (or all alerts if includeResolved is true).
 *
 * Response:
 *   {
 *     success: true,
 *     activeCount: N,
 *     alerts: [
 *       { id, cartId, type, reason, createdAt, resolvedAt, resolution, ... }
 *     ]
 *   }
 *
 * The admin page polls this every few seconds.
 *
 * No auth for now — we'll add admin auth later.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { includeResolved = false } = body || {};

    const alerts = await prisma.alert.findMany({
      where: includeResolved ? {} : { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const activeCount = alerts.filter((a) => a.resolvedAt === null).length;

    return NextResponse.json({
      success: true,
      activeCount,
      alerts: alerts.map((a) => ({
        id: a.id,
        cartId: a.cartId,
        sessionId: a.sessionId,
        type: a.type,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
        resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
        resolvedBy: a.resolvedBy,
        resolution: a.resolution,
      })),
    });
  } catch (error: any) {
    console.error('Error in /api/admin/alerts:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}