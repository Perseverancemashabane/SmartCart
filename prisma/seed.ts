import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding IoT Smart Shopping Cart Database...');

  // Seed Physical Carts
  const carts = [
    { id: 'CART_001', stationRfidTag: 'CART_RFID_001', status: 'available' },
    { id: 'CART_004', stationRfidTag: 'CART_RFID_004', status: 'available' },
    { id: 'CART_042', stationRfidTag: 'CART_RFID_042', status: 'available' },
  ];

  for (const cart of carts) {
    await prisma.cart.upsert({
      where: { id: cart.id },
      update: {},
      create: cart,
    });
  }

  // Seed Product Inventory with RFID Tags
  const products = [
    { rfidTagId: 'MILK-001', name: 'Organic Fresh Milk 2L', priceCents: 3250, stockQuantity: 50 },
    { rfidTagId: 'BREAD-002', name: 'Artisan Sourdough Bread', priceCents: 2400, stockQuantity: 40 },
    { rfidTagId: 'APPLE-003', name: 'Crisp Red Apples 1kg', priceCents: 4500, stockQuantity: 60 },
    { rfidTagId: 'STEAK-004', name: 'A-Grade Ribeye Steak 500g', priceCents: 18500, stockQuantity: 25 },
    { rfidTagId: 'WATER-005', name: 'Still Mineral Water 6-Pack', priceCents: 5500, stockQuantity: 100 },
    { rfidTagId: 'COFFEE-006', name: 'Espresso Coffee Beans 500g', priceCents: 12000, stockQuantity: 30 },
  ];

  for (const prod of products) {
    await prisma.product.upsert({
      where: { rfidTagId: prod.rfidTagId },
      update: {},
      create: prod,
    });
  }

  console.log('Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
