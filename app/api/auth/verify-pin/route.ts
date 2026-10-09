import { NextResponse } from 'next/server';
import { getSessionFromCookies, verifyPinById } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies(request.headers.get('cookie'));

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { pin } = body;

    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be 4 to 6 digits' },
        { status: 400 }
      );
    }

    const result = await verifyPinById(session.customerId, pin);

    if (!result.valid) {
      return NextResponse.json(
        { valid: false, error: result.reason || 'Incorrect PIN' },
        { status: 401 }
      );
    }

    return NextResponse.json({ valid: true });
  } catch (error: any) {
    console.error('Verify PIN error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}