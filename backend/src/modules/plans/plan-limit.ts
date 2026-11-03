import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/httpError";

type Db = Prisma.TransactionClient | typeof prisma;

// The app shows the "Choose Your Plan" paywall when it sees this code.
const upgradeRequired = (message: string, details: Record<string, unknown>) =>
  new HttpError(403, message, { code: "UPGRADE_REQUIRED", ...details });

async function loadPlan(db: Db, userId: number) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { trialEndsAt: true, plan: true },
  });
}

// The free trial is the only plan whose access ends by date rather than by a
// subscription expiring; paid plans are dropped back to FREE by the scheduler.
function assertTrialActive(user: Awaited<ReturnType<typeof loadPlan>>) {
  const onTrial = user.plan?.billingPeriod === "trial_15d";
  if (onTrial && user.trialEndsAt && user.trialEndsAt < new Date()) {
    throw upgradeRequired("Your 15-day free trial has ended. Subscribe to keep posting and bidding.", {
      reason: "trial_ended",
      trialEndsAt: user.trialEndsAt,
    });
  }
}

// Enforces the per-plan upload cap from the Subscription Model before an item is created.
export async function assertCanAddItem(userId: number, db: Db = prisma) {
  const user = await loadPlan(db, userId);
  assertTrialActive(user);
  if (!user.plan || user.plan.itemLimit === null) return;

  const used = await db.item.count({ where: { ownerId: userId } });
  if (used >= user.plan.itemLimit) {
    throw upgradeRequired(
      `Upload limit reached for the ${user.plan.name} plan (${user.plan.itemLimit} items). Upgrade to raise your limit.`,
      { reason: "item_limit", limit: user.plan.itemLimit, used }
    );
  }
}

// Every bid counts, including raising your own; the free trial is short enough
// that a lifetime count is the same as a per-trial count.
export async function assertCanBid(userId: number, db: Db = prisma) {
  const user = await loadPlan(db, userId);
  assertTrialActive(user);
  if (!user.plan || user.plan.bidLimit === null) return;

  const used = await db.bid.count({ where: { bidderId: userId } });
  if (used >= user.plan.bidLimit) {
    throw upgradeRequired(
      `You've used all ${user.plan.bidLimit} bids on the ${user.plan.name} plan. Subscribe for unlimited bidding.`,
      { reason: "bid_limit", limit: user.plan.bidLimit, used }
    );
  }
}
