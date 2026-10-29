import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { adminUserSelect, pageArgs, pageQuerySchema, recordAudit } from "./admin.shared";

// Dashboard, Analytics, Settings, the notifications panel and user feedback.
// Series are bucketed in application code: fine at current volume; move to
// SQL GROUP BY (or a rollup table) if these pages get slow.
export const adminDashboardRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

function startOfDayUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(key(r), (counts.get(key(r)) ?? 0) + 1));
  return counts;
}

const daysQuerySchema = z.object({ days: z.coerce.number().int().min(7).max(366).default(30) });

// Admin screen: Dashboard (stat cards, User Growth, weekly bars, Recent Users, Recent Subscription Activity).
adminDashboardRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const { days } = daysQuerySchema.parse(req.query);
    const now = new Date();
    const periodStart = startOfDayUtc(new Date(now.getTime() - (days - 1) * DAY_MS));
    const weekStart = startOfDayUtc(new Date(now.getTime() - 6 * DAY_MS));

    const [totalUsers, usersBefore, newUserRows, activeSubscriptions, activePromotions, weekSubs, weekPromos, recentUsers, recentSubs] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { lt: periodStart } } }),
        prisma.user.findMany({ where: { createdAt: { gte: periodStart } }, select: { createdAt: true } }),
        prisma.subscription.count({ where: { status: "ACTIVE" } }),
        prisma.promotion.count({ where: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } } }),
        prisma.subscription.findMany({ where: { createdAt: { gte: weekStart } }, select: { createdAt: true } }),
        prisma.promotion.findMany({ where: { createdAt: { gte: weekStart } }, select: { createdAt: true } }),
        prisma.user.findMany({ select: adminUserSelect, orderBy: { createdAt: "desc" }, take: 5 }),
        prisma.subscription.findMany({
          include: { user: { select: adminUserSelect }, plan: { select: { id: true, code: true, name: true } } },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

    const newByDay = countBy(newUserRows, (u) => dayKey(u.createdAt));
    let running = usersBefore;
    const userGrowth = Array.from({ length: days }, (_, i) => {
      const date = dayKey(new Date(periodStart.getTime() + i * DAY_MS));
      running += newByDay.get(date) ?? 0;
      return { date, newUsers: newByDay.get(date) ?? 0, totalUsers: running };
    });

    const subsByDay = countBy(weekSubs, (s) => dayKey(s.createdAt));
    const promosByDay = countBy(weekPromos, (p) => dayKey(p.createdAt));
    const weeklyActivity = Array.from({ length: 7 }, (_, i) => {
      const date = dayKey(new Date(weekStart.getTime() + i * DAY_MS));
      return { date, subscriptions: subsByDay.get(date) ?? 0, promotions: promosByDay.get(date) ?? 0 };
    });

    res.json({
      stats: { totalUsers, newUsers: newUserRows.length, activeSubscriptions, activePromotions },
      userGrowth,
      weeklyActivity,
      recentUsers,
      recentSubscriptionActivity: recentSubs,
    });
  })
);

const monthsQuerySchema = z.object({ months: z.coerce.number().int().min(2).max(36).default(12) });

// Admin screen: Analytics (Total / Subscription / Promotion Revenue, Revenue Growth, User Growth).
// Revenue = PAID payments; growth compares the latest month with the one before.
adminDashboardRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const { months } = monthsQuerySchema.parse(req.query);
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

    const [payments, usersBefore, newUsers] = await Promise.all([
      prisma.payment.findMany({
        where: { status: "PAID", paidAt: { gte: start } },
        select: { amountCents: true, paidAt: true, subscriptionId: true, promotionId: true },
      }),
      prisma.user.count({ where: { createdAt: { lt: start } } }),
      prisma.user.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } }),
    ]);

    const keys = Array.from({ length: months }, (_, i) => monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
    const revenue = new Map(keys.map((k) => [k, { subscriptionsCents: 0, promotionsCents: 0 }]));
    for (const p of payments) {
      const bucket = revenue.get(monthKey(p.paidAt!));
      if (!bucket) continue;
      if (p.promotionId) bucket.promotionsCents += p.amountCents;
      else bucket.subscriptionsCents += p.amountCents;
    }
    const usersByMonth = countBy(newUsers, (u) => monthKey(u.createdAt));
    let runningUsers = usersBefore;
    const series = keys.map((month) => {
      const r = revenue.get(month)!;
      runningUsers += usersByMonth.get(month) ?? 0;
      return { month, ...r, totalCents: r.subscriptionsCents + r.promotionsCents, newUsers: usersByMonth.get(month) ?? 0, totalUsers: runningUsers };
    });

    const totals = series.reduce(
      (acc, m) => ({
        totalCents: acc.totalCents + m.totalCents,
        subscriptionsCents: acc.subscriptionsCents + m.subscriptionsCents,
        promotionsCents: acc.promotionsCents + m.promotionsCents,
      }),
      { totalCents: 0, subscriptionsCents: 0, promotionsCents: 0 }
    );
    const [prev, last] = series.slice(-2);
    const growthPercent = prev.totalCents > 0 ? Math.round(((last.totalCents - prev.totalCents) / prev.totalCents) * 1000) / 10 : null;

    res.json({ revenue: { ...totals, growthPercent }, series });
  })
);

// Admin screen: Settings -> General.
const generalSettingsSchema = z.object({
  storeName: z.string().trim().min(1).max(80),
  supportEmail: z.string().email(),
  timezone: z.string().trim().min(1).max(64),
});

const defaultGeneralSettings = { storeName: "DAN-D Collection", supportEmail: "support@dandcollection.com", timezone: "Pacific Time (PT)" };

adminDashboardRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const row = await prisma.appSetting.findUnique({ where: { key: "general" } });
    res.json({ ...defaultGeneralSettings, ...(row?.value as object | undefined) });
  })
);

adminDashboardRouter.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    const patch = generalSettingsSchema.partial().parse(req.body);
    const row = await prisma.appSetting.findUnique({ where: { key: "general" } });
    const value = { ...defaultGeneralSettings, ...(row?.value as object | undefined), ...patch };
    await prisma.$transaction([
      prisma.appSetting.upsert({ where: { key: "general" }, create: { key: "general", value }, update: { value } }),
      recordAudit(prisma, { actorId: req.userId!, action: "settings.update", targetType: "settings", data: patch }),
    ]);
    res.json(value);
  })
);

// Admin top-bar notifications panel: a derived feed of what needs an admin's eye.
adminDashboardRouter.get(
  "/notifications",
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const userSummary = { select: { id: true, username: true, fullName: true, avatarUrl: true } };
    const [signups, subscriptions, failedPayments, feedback] = await Promise.all([
      prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { id: true, username: true, fullName: true, avatarUrl: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.subscription.findMany({ where: { createdAt: { gte: since } }, include: { user: userSummary, plan: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.payment.findMany({ where: { status: "FAILED", createdAt: { gte: since } }, include: { user: userSummary }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.feedback.findMany({ where: { createdAt: { gte: since } }, include: { user: userSummary }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    const feed = [
      ...signups.map((u) => ({ type: "user_signup" as const, at: u.createdAt, user: u, targetId: u.id })),
      ...subscriptions.map((s) => ({ type: "subscription_started" as const, at: s.createdAt, user: s.user, planName: s.plan.name, amountCents: s.amountCents, targetId: s.id })),
      ...failedPayments.map((p) => ({ type: "payment_failed" as const, at: p.createdAt, user: p.user, amountCents: p.amountCents, targetId: p.subscriptionId ?? p.promotionId })),
      ...feedback.map((f) => ({ type: "feedback" as const, at: f.createdAt, user: f.user, message: f.message, targetId: f.id })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    res.json(feed.slice(0, 40));
  })
);

// Feedback submitted from the apps' Help & Feedback screen.
adminDashboardRouter.get(
  "/feedback",
  asyncHandler(async (req, res) => {
    const q = pageQuerySchema.parse(req.query);
    const [items, total] = await Promise.all([
      prisma.feedback.findMany({ include: { user: { select: adminUserSelect } }, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
      prisma.feedback.count(),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  })
);
