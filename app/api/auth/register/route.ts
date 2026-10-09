import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  hashPin,
  signSession,
  normalizePhone,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone_number, pin, name, email } = body;

    // Validation
    if (!phone_number || !pin) {
      return NextResponse.json(
        { error: 'Phone number and PIN are required' },
        { status: 400 }
      );
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 }
      );
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be 4 to 6 digits' },
        { status: 400 }
      );
    }

    const normalized = normalizePhone(phone_number);
    if (normalized.length < 9) {
      return NextResponse.json(
        { error: 'Please enter a valid phone number' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check phone
    const existingPhone = await prisma.customer.findUnique({
      where: { phoneNumber: normalized },
    });
    if (existingPhone) {
      return NextResponse.json(
        { error: 'This phone number is already registered. Please log in.' },
        { status: 409 }
      );
    }

    // Check email
    const existingEmail = await prisma.customer.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingEmail) {
      return NextResponse.json(
        { error: 'This email is already registered. Please log in.' },
        { status: 409 }
      );
    }

    // Hash PIN and create
    const pinHash = await hashPin(pin);
    const customer = await prisma.customer.create({
      data: {
        phoneNumber: normalized,
        email: normalizedEmail,
        pinHash,
        name: name || null,
      },
      select: {
        id: true,
        phoneNumber: true,
        email: true,
        name: true,
        walletBalanceCents: true,
      },
    });

    // Sign session
    const token = await signSession({
      customerId: customer.id,
      phoneNumber: customer.phoneNumber,
    });

    const response = NextResponse.json({
      success: true,
      customer,
    });

    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return response;
  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}