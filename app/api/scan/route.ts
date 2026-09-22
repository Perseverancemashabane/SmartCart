import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

// This connects to your database using the secret .env.local file
const sql = neon(process.env.DATABASE_URL!);

export async function POST(request: NextRequest) {
  try {
    // 1. Get the tag_uid from the ESP32
    const body = await request.json();
    const { tag_uid } = body;

    if (!tag_uid) {
      return NextResponse.json({ error: 'tag_uid is required' }, { status: 400 });
    }

    // 2. Look up the item in the Neon database
    const result = await sql`
      SELECT name, price FROM items WHERE tag_uid = ${tag_uid}
    `;

    // 3. If the item is not found, tell the ESP32
    if (result.length === 0) {
      return NextResponse.json({ found: false, message: 'Item not found' });
    }

    // 4. If found, send back the name and price
    return NextResponse.json({ found: true, item: result[0] });

  } catch (error) {
    console.error('Scan API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}