import { prisma } from "../config/prisma";
import { closeAuction } from "../modules/auctions/auctions.service";

const TICK_MS = 60 * 1000;

// Time-driven state changes nothing else triggers: auctions go live at startsAt
// and settle at endsAt; promotions expire at endsAt. Runs in-process, which is
// fine for a single server instance; move to a queue if the API is scaled out.
export async function runScheduledJobs(now = new Date()) {
  await prisma.auction.updateMany({
    where: { status: "SCHEDULED", startsAt: { lte: now }, endsAt: { gt: now } },
    data: { status: "LIVE" },
  });

  const due = await prisma.auction.findMany({
    where: { status: { in: ["SCHEDULED", "LIVE"] }, endsAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of due) {
    try {
      await closeAuction(id);
    } catch (err) {
      console.error(`[scheduler] failed to close auction ${id}`, err);
    }
  }

  await prisma.promotion.updateMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, endsAt: { lte: now } },
    data: { status: "EXPIRED" },
  });

  // Subscriptions end at expiresAt and the user drops back to the Free plan.
  // Auto-renew isn't honoured yet: renewal needs a real charge, which belongs
  // to the payment processor / IAP webhook once one is wired up.
  const ended = await prisma.subscription.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: { id: true, userId: true },
  });
  if (ended.length > 0) {
    const freePlan = await prisma.plan.findUnique({ where: { code: "FREE" } });
    await prisma.$transaction([
      prisma.subscription.updateMany({ where: { id: { in: ended.map((s) => s.id) } }, data: { status: "EXPIRED" } }),
      prisma.user.updateMany({
        where: { id: { in: ended.map((s) => s.userId) }, subscriptions: { none: { status: "ACTIVE", expiresAt: { gt: now } } } },
        data: { planId: freePlan?.id ?? null, planExpiresAt: null },
      }),
    ]);
  }
}

export function startScheduler() {
  const tick = () => runScheduledJobs().catch((err) => console.error("[scheduler] tick failed", err));
  tick();
  return setInterval(tick, TICK_MS).unref();
}
