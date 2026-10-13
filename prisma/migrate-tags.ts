import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Migrating product tags ===\n');

  // Get all products that still have a legacy rfidTagId
  const products = await prisma.product.findMany({
    where: {
      rfidTagId: { not: null },
    },
    select: {
      id: true,
      name: true,
      rfidTagId: true,
    },
  });

  console.log(`Found ${products.length} product(s) with legacy tag.\n`);

  let migrated = 0;
  let skipped = 0;

  for (const product of products) {
    if (!product.rfidTagId) continue;

    // Check if this tag already exists in ProductTag
    const existing = await prisma.productTag.findUnique({
      where: { rfidTagId: product.rfidTagId },
    });

    if (existing) {
      console.log(
        `  ⏭  ${product.name.padEnd(35)} tag ${product.rfidTagId} (already migrated)`
      );
      skipped++;
      continue;
    }

    // Create the ProductTag
    await prisma.productTag.create({
      data: {
        rfidTagId: product.rfidTagId,
        productId: product.id,
        isActive: true,
      },
    });

    console.log(
      `  ✔  ${product.name.padEnd(35)} tag ${product.rfidTagId} → productId ${product.id}`
    );
    migrated++;
  }

  console.log('\n=== Summary ===');
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped:  ${skipped} (already existed)`);
  console.log(`  Total:    ${products.length}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });