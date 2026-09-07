import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Seeds the four subscription tiers from the proposal's Subscription Model
// section, plus a starter Harley-Davidson-flavored category tree so "What Do
// You Collect" and item creation have real options in dev.
async function main() {
  await prisma.plan.createMany({
    data: [
      { code: "FREE", name: "Free Trial", priceCents: 0, billingPeriod: "trial_15d", itemLimit: 100 },
      { code: "SILVER", name: "Silver Package", priceCents: 499, billingPeriod: "year", itemLimit: 200 },
      { code: "GOLD", name: "Gold Package", priceCents: 999, billingPeriod: "year", itemLimit: 450 },
      { code: "PLATINUM", name: "Platinum Package", priceCents: 1999, billingPeriod: "year", itemLimit: null },
    ],
    skipDuplicates: true,
  });

  const motorcycles = await prisma.category.upsert({
    where: { slug: "motorcycles" },
    update: {},
    create: { name: "Motorcycles & Memorabilia", slug: "motorcycles" },
  });

  await prisma.category.createMany({
    data: [
      { name: "Harley-Davidson Pins", slug: "hd-pins", parentId: motorcycles.id },
      { name: "Harley-Davidson Patches", slug: "hd-patches", parentId: motorcycles.id },
      { name: "Vintage Dealer Signs", slug: "dealer-signs", parentId: motorcycles.id },
      { name: "Rally Posters & Flyers", slug: "rally-posters", parentId: motorcycles.id },
      { name: "Belt Buckles", slug: "belt-buckles", parentId: motorcycles.id },
    ],
    skipDuplicates: true,
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
