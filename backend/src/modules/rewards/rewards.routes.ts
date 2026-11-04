import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { HttpError, badRequest, notFound } from "../../utils/httpError";
import { assertCanAddItem } from "../plans/plan-limit";
import { CENTS_PER_POINT, lockUser, pointsBalance, pointsForCents, walletSummary } from "./points";

export const walletRouter = Router();
export const leaderboardRouter = Router();
export const officialChipsRouter = Router();

// Screen: Wallet (balance card).
walletRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(walletSummary(await pointsBalance(req.userId!)));
  })
);

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

// Screens: Wallet (Recent Transactions), Transaction History.
walletRouter.get(
  "/transactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = pageSchema.parse(req.query);
    const where = { userId: req.userId! };
    const [rows, total] = await Promise.all([
      prisma.pointsEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.pointsEntry.count({ where }),
    ]);
    res.json({
      items: rows.map((r) => ({ ...r, amountCents: r.points * CENTS_PER_POINT })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  })
);

// Screen: Leaderboard. Top 20 collectors by chips owned, plus where the caller stands.
leaderboardRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ranked = { status: "ACTIVE" as const, isAdmin: false };
    const top = await prisma.user.findMany({
      where: { ...ranked, items: { some: {} } },
      select: { id: true, username: true, fullName: true, avatarUrl: true, address: true, _count: { select: { items: true } } },
      orderBy: [{ items: { _count: "desc" } }, { createdAt: "asc" }],
      take: 20,
    });
    const rows = top.map(({ _count, ...u }, i) => ({ rank: i + 1, ...u, chipCount: _count.items }));

    const mine = await prisma.item.count({ where: { ownerId: req.userId! } });
    let me = rows.find((r) => r.id === req.userId);
    if (!me) {
      // Outside the top 20: one place behind everyone with more chips.
      const withMore = await countUsersWithMoreThan(mine, req.userId!);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.userId! },
        select: { id: true, username: true, fullName: true, avatarUrl: true, address: true },
      });
      me = { rank: withMore + 1, ...user, chipCount: mine };
    }
    res.json({ top: rows, me });
  })
);

async function countUsersWithMoreThan(chips: number, exceptId: number) {
  const groups = await prisma.item.groupBy({
    by: ["ownerId"],
    where: { owner: { status: "ACTIVE", isAdmin: false }, ownerId: { not: exceptId } },
    _count: { _all: true },
    having: { ownerId: { _count: { gt: chips } } },
  });
  return groups.length;
}

async function ownedCounts(userId: number) {
  const rows = await prisma.officialChipPurchase.groupBy({ by: ["chipId"], where: { userId }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.chipId, r._count._all]));
}

// Screen: Chip Marketplace (DanD's own chips, bought with points).
officialChipsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [chips, owned] = await Promise.all([
      prisma.officialChip.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } }),
      ownedCounts(req.userId!),
    ]);
    res.json(
      chips.map((c) => {
        const mine = owned.get(c.id) ?? 0;
        return {
          ...c,
          pricePoints: pointsForCents(c.priceCents),
          owned: mine,
          soldOut: c.stock !== null && c.stock <= 0,
          limitReached: c.perUserLimit !== null && mine >= c.perUserLimit,
        };
      })
    );
  })
);

// Purchase Review -> Purchase Success. Spends points and puts a copy of the
// chip in the buyer's collection, all or nothing.
officialChipsRouter.post(
  "/:id/buy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const chipId = Number(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const chip = await tx.officialChip.findUnique({ where: { id: chipId } });
      if (!chip || !chip.active) throw notFound("Chip not found");
      if (chip.stock !== null && chip.stock <= 0) throw badRequest("This chip is sold out");
      if (chip.perUserLimit !== null) {
        const owned = await tx.officialChipPurchase.count({ where: { userId, chipId } });
        if (owned >= chip.perUserLimit) throw badRequest(`You can own at most ${chip.perUserLimit} of this chip`);
      }
      const price = pointsForCents(chip.priceCents);
      const balance = await pointsBalance(userId, tx);
      if (balance < price) {
        throw new HttpError(400, "Not enough points for this chip", { code: "INSUFFICIENT_POINTS", balance, price });
      }
      await assertCanAddItem(userId, tx);

      if (chip.stock !== null) {
        // Guarded update so stock can't go below zero even across users.
        const left = await tx.officialChip.updateMany({ where: { id: chip.id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
        if (left.count === 0) throw badRequest("This chip is sold out");
      }
      const item = await tx.item.create({
        data: {
          ownerId: userId,
          title: chip.title,
          description: chip.description,
          brand: chip.series,
          condition: "Mint",
          estimatedValueCents: chip.priceCents,
          images: chip.imageUrl ? { create: [{ url: chip.imageUrl }] } : undefined,
        },
      });
      const purchase = await tx.officialChipPurchase.create({ data: { userId, chipId: chip.id, pricePoints: price, itemId: item.id } });
      await tx.pointsEntry.create({
        data: { userId, points: -price, reason: "CHIP_PURCHASE", note: chip.title, chipPurchaseId: purchase.id },
      });
      return { purchase, item, wallet: walletSummary(balance - price) };
    });
    res.status(201).json(result);
  })
);
