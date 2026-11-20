// One-off for the move from a 15 to a 30-day free trial: gives everyone still on
// the trial plan an end date of sign-up + 30 days. Never shortens a trial.
// Prints what it would change; pass --apply to write.
//   npm run trials:extend
//   npm run trials:extend -- --apply
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TRIAL_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const apply = process.argv.includes("--apply");
  const users = await prisma.user.findMany({
    where: { plan: { billingPeriod: "trial_15d" }, trialEndsAt: { not: null } },
    select: { id: true, email: true, createdAt: true, trialEndsAt: true },
  });

  const now = new Date();
  let changed = 0;
  let reopened = 0;
  for (const user of users) {
    const newEnd = new Date(user.createdAt.getTime() + TRIAL_DAYS * DAY);
    if (newEnd <= user.trialEndsAt!) continue;
    changed++;
    if (user.trialEndsAt! < now && newEnd > now) reopened++;
    console.log(`${user.email}: ${user.trialEndsAt!.toISOString().slice(0, 10)} -> ${newEnd.toISOString().slice(0, 10)}`);
    if (apply) await prisma.user.update({ where: { id: user.id }, data: { trialEndsAt: newEnd } });
  }

  console.log(`${users.length} on the trial plan, ${changed} ${apply ? "extended" : "would be extended"} (${reopened} of them had already ended).`);
  if (!apply && changed) console.log("Dry run. Run again with --apply to save.");
}

main().finally(() => prisma.$disconnect());
