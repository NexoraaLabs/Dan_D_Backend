import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { badRequest, notFound } from "../../utils/httpError";
import { adminUserSelect, pageArgs, pageQuerySchema, recordAudit } from "./admin.shared";
import { pointsBalance, pointsForCents, walletSummary } from "../rewards/points";

export const adminDealersRouter = Router();
export const adminOfficialChipsRouter = Router();
export const adminCheckInsRouter = Router();
export const adminPointsRouter = Router();

const dealerSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  tags: z.string().trim().nullish(),
  active: z.boolean().optional(),
});

// Admin screen: Dealers (list, with how often each is visited).
adminDealersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = pageQuerySchema.extend({ search: z.string().trim().optional(), active: z.enum(["true", "false"]).optional() }).parse(req.query);
    const where: Prisma.DealerWhereInput = {
      active: q.active === undefined ? undefined : q.active === "true",
      ...(q.search ? { OR: [{ name: { contains: q.search } }, { address: { contains: q.search } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.dealer.findMany({ where, include: { _count: { select: { checkIns: true } } }, orderBy: { name: "asc" }, ...pageArgs(q) }),
      prisma.dealer.count({ where }),
    ]);
    res.json({ items: items.map(({ _count, ...d }) => ({ ...d, checkInCount: _count.checkIns })), total, page: q.page, pageSize: q.pageSize });
  })
);

adminDealersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = dealerSchema.parse(req.body);
    const dealer = await prisma.dealer.create({ data });
    await recordAudit(prisma, { actorId: req.userId!, action: "dealer.create", targetType: "dealer", targetId: dealer.id });
    res.status(201).json(dealer);
  })
);

adminDealersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = dealerSchema.partial().parse(req.body);
    if (!(await prisma.dealer.findUnique({ where: { id } }))) throw notFound("Dealer not found");
    const dealer = await prisma.dealer.update({ where: { id }, data });
    await recordAudit(prisma, { actorId: req.userId!, action: "dealer.update", targetType: "dealer", targetId: id, data });
    res.json(dealer);
  })
);

// A dealer with check-ins is archived instead, so points history keeps its name.
adminDealersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const dealer = await prisma.dealer.findUnique({ where: { id }, include: { _count: { select: { checkIns: true } } } });
    if (!dealer) throw notFound("Dealer not found");
    if (dealer._count.checkIns > 0) throw badRequest("This dealer has check-ins. Archive it instead (set active to false).");
    await prisma.dealer.delete({ where: { id } });
    await recordAudit(prisma, { actorId: req.userId!, action: "dealer.delete", targetType: "dealer", targetId: id });
    res.status(204).send();
  })
);

const chipSchema = z.object({
  title: z.string().trim().min(1),
  series: z.string().trim().nullish(),
  location: z.string().trim().nullish(),
  description: z.string().trim().nullish(),
  imageUrl: z.string().url().nullish(),
  badge: z.string().trim().nullish(),
  priceCents: z.number().int().min(0),
  stock: z.number().int().min(0).nullish(),
  perUserLimit: z.number().int().min(1).nullish(),
  active: z.boolean().optional(),
});

// Admin screen: Official Chips (the Chip Marketplace catalogue).
adminOfficialChipsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const chips = await prisma.officialChip.findMany({ include: { _count: { select: { purchases: true } } }, orderBy: { createdAt: "desc" } });
    res.json(chips.map(({ _count, ...c }) => ({ ...c, pricePoints: pointsForCents(c.priceCents), sold: _count.purchases })));
  })
);

adminOfficialChipsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const chip = await prisma.officialChip.create({ data: chipSchema.parse(req.body) });
    await recordAudit(prisma, { actorId: req.userId!, action: "official_chip.create", targetType: "official_chip", targetId: chip.id });
    res.status(201).json(chip);
  })
);

adminOfficialChipsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = chipSchema.partial().parse(req.body);
    if (!(await prisma.officialChip.findUnique({ where: { id } }))) throw notFound("Chip not found");
    const chip = await prisma.officialChip.update({ where: { id }, data });
    await recordAudit(prisma, { actorId: req.userId!, action: "official_chip.update", targetType: "official_chip", targetId: id, data });
    res.json(chip);
  })
);

// Admin screen: Check-ins (most recent first).
adminCheckInsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = pageQuerySchema.extend({ dealerId: z.coerce.number().int().optional(), userId: z.coerce.number().int().optional() }).parse(req.query);
    const where = { dealerId: q.dealerId, userId: q.userId };
    const [items, total] = await Promise.all([
      prisma.dealerCheckIn.findMany({
        where,
        include: { user: { select: adminUserSelect }, dealer: { select: { id: true, name: true, address: true } } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(q),
      }),
      prisma.dealerCheckIn.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  })
);

// Admin: a user's points balance and ledger, and manual corrections.
adminPointsRouter.get(
  "/:userId",
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    const [balance, entries] = await Promise.all([
      pointsBalance(userId),
      prisma.pointsEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    res.json({ wallet: walletSummary(balance), entries });
  })
);

const adjustSchema = z.object({ points: z.number().int().refine((n) => n !== 0, "points can't be 0"), note: z.string().trim().min(1) });

adminPointsRouter.post(
  "/:userId/adjust",
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    const { points, note } = adjustSchema.parse(req.body);
    if (!(await prisma.user.findUnique({ where: { id: userId } }))) throw notFound("User not found");
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.pointsEntry.create({ data: { userId, points, reason: "ADJUSTMENT", note } });
      await recordAudit(tx, { actorId: req.userId!, action: "points.adjust", targetType: "user", targetId: userId, reason: note, data: { points } });
      return created;
    });
    res.status(201).json({ entry, wallet: walletSummary(await pointsBalance(userId)) });
  })
);
