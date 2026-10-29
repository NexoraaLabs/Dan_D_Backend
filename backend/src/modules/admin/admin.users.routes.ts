import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
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
      },
    });
    if (!user) throw notFound("User not found");
    res.json(user);
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

// Admin dialog: "Suspend this account?" -- loses access until restored.
adminUsersRouter.post(
  "/:id/suspend",
  asyncHandler(async (req, res) => {
    const { reason } = reasonSchema.parse(req.body ?? {});
    const target = await loadActionTarget(req.userId!, Number(req.params.id));
    if (target.status === "BANNED") throw badRequest("This account is banned");
    const user = await prisma.$transaction(async (tx) => {
      // Refresh tokens are revoked so the app can't silently sign back in.
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await recordAudit(tx, { actorId: req.userId!, action: "user.suspend", targetType: "user", targetId: target.id, reason });
      return tx.user.update({ where: { id: target.id }, data: { status: "SUSPENDED" }, select: adminUserSelect });
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
    const user = await prisma.$transaction(async (tx) => {
      await recordAudit(tx, { actorId: req.userId!, action: "user.restore", targetType: "user", targetId: target.id, reason });
      return tx.user.update({ where: { id: target.id }, data: { status: "ACTIVE" }, select: adminUserSelect });
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
      return tx.user.update({ where: { id: target.id }, data: { status: "BANNED" }, select: adminUserSelect });
    });
    res.json(user);
  })
);
