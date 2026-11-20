import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { createNotification } from "../notifications/notifications.service";
import { adminUserSelect, pageArgs, pageQuerySchema, recordAudit } from "./admin.shared";

export const adminUsersRouter = Router();

// Admin screen: User Management tabs (All / Active / Free Users / Suspended / Subscribed), plus Banned.
const listQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().optional(),
  filter: z.enum(["all", "active", "free", "suspended", "subscribed", "banned"]).default("all"),
  sort: z.enum(["newest", "oldest", "lastActive"]).default("newest"),
});

const filterWhere: Record<z.infer<typeof listQuerySchema>["filter"], Prisma.UserWhereInput> = {
  all: {},
  active: { status: "ACTIVE" },
  free: { OR: [{ planId: null }, { plan: { code: "FREE" } }] },
  suspended: { status: "SUSPENDED" },
  subscribed: { subscriptions: { some: { status: "ACTIVE" } } },
  banned: { status: "BANNED" },
};

const userListInclude = {
  plan: { select: { id: true, code: true, name: true } },
  // Latest subscription only: drives the "Subscription" column.
  subscriptions: { orderBy: { createdAt: "desc" as const }, take: 1, select: { id: true, status: true, planId: true } },
};

adminUsersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const where: Prisma.UserWhereInput = {
      ...filterWhere[q.filter],
      ...(q.search
        ? { AND: [{ OR: [{ fullName: { contains: q.search } }, { username: { contains: q.search } }, { email: { contains: q.search } }] }] }
        : {}),
    };
    const orderBy: Prisma.UserOrderByWithRelationInput =
      q.sort === "oldest" ? { createdAt: "asc" } : q.sort === "lastActive" ? { lastActiveAt: "desc" } : { createdAt: "desc" };
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, select: { ...adminUserSelect, ...userListInclude }, orderBy, ...pageArgs(q) }),
      prisma.user.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  })
);

// Admin screen: User Details (summary, subscription information, promotion information).
adminUsersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.params.id) },
      select: {
        ...adminUserSelect,
        phone: true,
        address: true,
        trialEndsAt: true,
        planExpiresAt: true,
        plan: true,
        subscriptions: { orderBy: { createdAt: "desc" }, take: 5, include: { plan: true } },
        promotions: { orderBy: { startsAt: "desc" }, take: 5 },
        _count: { select: { items: true, listings: true, ordersAsBuyer: true, ordersAsSeller: true } },
        moderationRecords: {
          orderBy: { createdAt: "desc" },
          include: { admin: { select: { id: true, username: true, fullName: true } } },
        },
      },
    });
    if (!user) throw notFound("User not found");
    const suspensions = user.moderationRecords.filter((r) => r.action === "SUSPENSION").length;
    res.json({ ...user, nextStep: nextStep(suspensions) });
  })
);

const reasonSchema = z.object({ reason: z.string().trim().max(2000).optional() });

/** Loads the target and refuses actions an admin shouldn't take on themselves or another admin. */
async function loadActionTarget(adminId: number, targetId: number) {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw notFound("User not found");
  if (target.id === adminId) throw badRequest("You can't do this to your own account");
  if (target.isAdmin) throw forbidden("Admins can't suspend or ban other admins");
  return target;
}

// The ladder Daniel described on the 13 Nov call: first time 2 days, then a week, then removed.
// Only a suggestion; the admin can pick any length.
function nextStep(suspensions: number) {
  if (suspensions === 0) return { action: "SUSPENSION", days: 2 } as const;
  if (suspensions === 1) return { action: "SUSPENSION", days: 7 } as const;
  return { action: "BAN", days: null } as const;
}

const DAY = 24 * 60 * 60 * 1000;

const noteSchema = z.object({ reason: z.string().trim().min(1, "Write the note the user will see").max(2000) });

const suspendSchema = noteSchema.extend({
  // Null or left out = until an admin restores the account.
  days: z.number().int().min(1).max(365).nullish(),
});

// Admin: "Warn" -- a note in the user's notifications, kept in their history. No loss of access.
adminUsersRouter.post(
  "/:id/warn",
  asyncHandler(async (req, res) => {
    const { reason } = noteSchema.parse(req.body ?? {});
    const target = await loadActionTarget(req.userId!, Number(req.params.id));
    if (target.status === "BANNED") throw badRequest("This account is banned");
    const record = await prisma.$transaction(async (tx) => {
      await createNotification(tx, { userId: target.id, type: "moderation_warning", title: "Warning from DAN-D Collection", body: reason });
      await recordAudit(tx, { actorId: req.userId!, action: "user.warn", targetType: "user", targetId: target.id, reason });
      return tx.moderationRecord.create({ data: { userId: target.id, adminId: req.userId!, action: "WARNING", reason } });
    });
    res.status(201).json(record);
  })
);

// Admin dialog: "Suspend this account?" -- for a number of days (reopens on its own) or until restored.
// The note is shown to the user when they try to sign in.
adminUsersRouter.post(
  "/:id/suspend",
  asyncHandler(async (req, res) => {
    const { reason, days } = suspendSchema.parse(req.body ?? {});
    const target = await loadActionTarget(req.userId!, Number(req.params.id));
    if (target.status === "BANNED") throw badRequest("This account is banned");
    const endsAt = days ? new Date(Date.now() + days * DAY) : null;
    const user = await prisma.$transaction(async (tx) => {
      // Refresh tokens are revoked so the app can't silently sign back in.
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      // Seen when they're back, so the history makes sense to them too.
      await createNotification(tx, {
        userId: target.id,
        type: "moderation_suspension",
        title: days ? `Your account was suspended for ${days} ${days === 1 ? "day" : "days"}` : "Your account was suspended",
        body: reason,
      });
      await recordAudit(tx, { actorId: req.userId!, action: "user.suspend", targetType: "user", targetId: target.id, reason, data: { days } });
      await tx.moderationRecord.create({
        data: { userId: target.id, adminId: req.userId!, action: "SUSPENSION", reason, days: days ?? null, endsAt },
      });
      return tx.user.update({ where: { id: target.id }, data: { status: "SUSPENDED", suspendedUntil: endsAt }, select: adminUserSelect });
    });
    res.json(user);
  })
);

adminUsersRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const { reason } = reasonSchema.parse(req.body ?? {});
    const target = await loadActionTarget(req.userId!, Number(req.params.id));
    if (target.status !== "SUSPENDED") throw badRequest("Only suspended accounts can be restored");
    const now = new Date();
    const user = await prisma.$transaction(async (tx) => {
      await recordAudit(tx, { actorId: req.userId!, action: "user.restore", targetType: "user", targetId: target.id, reason });
      // Marks the running suspension as ended early, so the history shows it.
      await tx.moderationRecord.updateMany({
        where: { userId: target.id, action: "SUSPENSION", liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        data: { liftedAt: now },
      });
      return tx.user.update({ where: { id: target.id }, data: { status: "ACTIVE", suspendedUntil: null }, select: adminUserSelect });
    });
    res.json(user);
  })
);

// Admin dialog: "Permanently ban this account?" (type BAN). The row is kept, so the
// email can't be registered again; their listings and promotions stop showing.
adminUsersRouter.post(
  "/:id/ban",
  asyncHandler(async (req, res) => {
    const { reason } = reasonSchema.parse(req.body ?? {});
    const target = await loadActionTarget(req.userId!, Number(req.params.id));
    const user = await prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.marketplaceListing.updateMany({ where: { sellerId: target.id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      await tx.promotion.updateMany({ where: { userId: target.id, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "CANCELLED" } });
      await recordAudit(tx, { actorId: req.userId!, action: "user.ban", targetType: "user", targetId: target.id, reason });
      await tx.moderationRecord.create({
        data: { userId: target.id, adminId: req.userId!, action: "BAN", reason: reason || "No reason given" },
      });
      return tx.user.update({ where: { id: target.id }, data: { status: "BANNED", suspendedUntil: null }, select: adminUserSelect });
    });
    res.json(user);
  })
);
