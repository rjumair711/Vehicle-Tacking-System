import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "admin@fleettrack.com" },
    update: {
      passwordHash,
    },
    create: {
      email: "admin@fleettrack.com",
      username: "System Admin",
      passwordHash,
    },
  });

  console.log("Admin seeded successfully");
}

main()
  .catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });