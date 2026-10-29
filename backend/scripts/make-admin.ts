// Grants (or with --revoke, removes) admin access for an existing account, so
// it can sign in to the admin dashboard. There's deliberately no API for this.
//   npm run admin:grant -- someone@example.com
//   npm run admin:grant -- someone@example.com --revoke
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const revoke = process.argv.includes("--revoke");
  if (!email || email.startsWith("--")) {
    console.error("Usage: npm run admin:grant -- <email> [--revoke]");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account with email ${email}. Register it in the app first.`);
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: !revoke } });
  console.log(`${email} ${revoke ? "is no longer" : "is now"} an admin.`);
}

main().finally(() => prisma.$disconnect());
