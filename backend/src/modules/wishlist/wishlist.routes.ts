import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { forbidden, notFound } from "../../utils/httpError";

export const wishlistRouter = Router();

// Screen: Wishlist
wishlistRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const entries = await prisma.wishlist.findMany({
      where: { userId: req.userId! },
      include: { category: true, matchedItem: { include: { images: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(entries);
  })
);

const createSchema = z.object({
  query: z.string().min(1),
  categoryId: z.number().int().optional(),
});

// Screen: Wishlist - Item Added
wishlistRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const entry = await prisma.wishlist.create({ data: { ...input, userId: req.userId! } });
    res.status(201).json(entry);
  })
);

wishlistRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.wishlist.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Wishlist entry not found");
    if (existing.userId !== req.userId) throw forbidden();
    await prisma.wishlist.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

// Smart Discovery & Matching: naive keyword match against active FOR_TRADE /
// marketplace items in the same category. Good enough to prove the flow;
// swap for a real search index (e.g. Meilisearch/Elasticsearch) at scale.
wishlistRouter.get(
  "/:id/matches",
  requireAuth,
  asyncHandler(async (req, res) => {
    const entry = await prisma.wishlist.findUnique({ where: { id: Number(req.params.id) } });
    if (!entry) throw notFound("Wishlist entry not found");

    const matches = await prisma.item.findMany({
      where: {
        categoryId: entry.categoryId ?? undefined,
        status: { in: ["FOR_TRADE", "SHOWCASE"] },
        ownerId: { not: req.userId! },
        title: { contains: entry.query },
      },
      include: { images: true, owner: { select: { id: true, username: true, avatarUrl: true } } },
      take: 20,
    });
    res.json(matches);
  })
);
