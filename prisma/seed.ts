import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@fleettrack.com' },
    update: {},
    create: {
      email: 'admin@fleettrack.com',
      name: 'System Admin',
      passwordHash,
      role: UserRole.ADMIN,
      company: 'FleetTrack',
    },
  });

  console.log('Admin seeded successfully');
}

main()
  .catch((error) => {
    console.error('Seed error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });