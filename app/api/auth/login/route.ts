import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  verifyPin,
  signSession,
  normalizePhone,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/auth';

const MAX_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone_number, pin } = body;

    if (!phone_number || !pin) {
      return NextResponse.json(
        { error: 'Phone number and PIN are required' },
        { status: 400 }
      );
    }

    const normalized = normalizePhone(phone_number);

    const customer = await prisma.customer.findUnique({
      where: { phoneNumber: normalized },
    });

    if (!customer || !customer.pinHash) {
      return NextResponse.json(
        { error: 'Invalid phone number or PIN' },
        { status: 401 }
      );
    }

    // --- Check lockout ---
    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      const secondsLeft = Math.ceil(
        (customer.lockedUntil.getTime() - Date.now()) / 1000
      );
      const minutesLeft = Math.ceil(secondsLeft / 60);
      return NextResponse.json(
        {
          error: `Account locked. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
          lockedUntil: customer.lockedUntil.toISOString(),
          retryAfterSeconds: secondsLeft,
        },
        { status: 429 }
      );
    }

    // --- Verify PIN ---
    const valid = await verifyPin(pin, customer.pinHash);

    if (!valid) {
      const newAttempts = customer.failedLoginAttempts + 1;

      if (newAttempts >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        await prisma.customer.update({
          where: { id: customer.id },
          data: {
            failedLoginAttempts: newAttempts,
            lockedUntil: lockedUntil,
          },
        });

        return NextResponse.json(
          {
            error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
            lockedUntil: lockedUntil.toISOString(),
            retryAfterSeconds: LOCKOUT_MINUTES * 60,
          },
          { status: 429 }
        );
      }

      await prisma.customer.update({
        where: { id: customer.id },
        data: { failedLoginAttempts: newAttempts },
      });

      const attemptsLeft = MAX_ATTEMPTS - newAttempts;
      return NextResponse.json(
        {
          error: `Invalid phone number or PIN. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.`,
          attemptsLeft: attemptsLeft,
        },
        { status: 401 }
      );
    }

    // --- Success: reset counters, create session ---
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    const token = await signSession({
      customerId: customer.id,
      phoneNumber: customer.phoneNumber,
    });

    const response = NextResponse.json({
      success: true,
      customer: {
        id: customer.id,
        phoneNumber: customer.phoneNumber,
        email: customer.email,
        name: customer.name,
        walletBalanceCents: customer.walletBalanceCents,
      },
    });

    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return response;
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}