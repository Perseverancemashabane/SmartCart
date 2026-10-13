import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const staffPin = process.env.STAFF_PIN || '9999';
  const pinHash = await bcrypt.hash(staffPin, 10);

  const existing = await prisma.staff.findFirst({
    where: { name: 'Admin' },
  });

  if (existing) {
    await prisma.staff.update({
      where: { id: existing.id },
      data: { pinHash, isActive: true },
    });
    console.log(`✔ Updated existing staff 'Admin' with new PIN.`);
  } else {
    await prisma.staff.create({
      data: {
        name: 'Admin',
        pinHash,
        isActive: true,
      },
    });
    console.log(`✔ Created new staff 'Admin'.`);
  }

  console.log(`   Staff PIN is: ${staffPin}`);
  console.log(`   Change it later from the admin page.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });