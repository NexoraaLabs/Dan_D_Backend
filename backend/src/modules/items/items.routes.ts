import { Router } from "express";
import { z } from "zod";
import { ItemStatus, Rarity } from "@prisma/client";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { forbidden, notFound } from "../../utils/httpError";
import { assertCanAddItem } from "../plans/plan-limit";

export const itemsRouter = Router();

const listQuerySchema = z.object({
  ownerId: z.coerce.number().int().optional(),
  status: z.nativeEnum(ItemStatus).optional(),
  rarity: z.nativeEnum(Rarity).optional(),
  categoryId: z.coerce.number().int().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Screens: Home / My Profile - Listings / My Profile - Wishlist (status=WANT)
itemsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const where = {
      ownerId: q.ownerId,
      status: q.status,
      categoryId: q.categoryId,
      rarity: q.rarity,
      title: q.search ? { contains: q.search } : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        include: { images: true, category: true },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.item.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  })
);

// Screens: Item Detail - *
itemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const item = await prisma.item.findUnique({
      where: { id: Number(req.params.id) },
      include: { images: true, category: true, owner: { select: { id: true, username: true, avatarUrl: true } }, listing: true },
    });
    if (!item) throw notFound("Item not found");
    res.json(item);
  })
);

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.nativeEnum(ItemStatus).default("HAVE"),
  rarity: z.nativeEnum(Rarity).optional(),
  categoryId: z.number().int().optional(),
  collectionId: z.number().int().optional(),
  condition: z.string().optional(),
  brand: z.string().optional(),
  year: z.number().int().optional(),
  estimatedValueCents: z.number().int().optional(),
  imageUrls: z.array(z.string().url()).default([]),
});

// Screens: Add Item - Camera Scan -> Item Details Form - Trade/Sale/Auction -> Add to Collection
itemsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    await assertCanAddItem(req.userId!);

    const item = await prisma.item.create({
      data: {
        ownerId: req.userId!,
        title: input.title,
        description: input.description,
        status: input.status,
        rarity: input.rarity,
        categoryId: input.categoryId,
        collectionId: input.collectionId,
        condition: input.condition,
        brand: input.brand,
        year: input.year,
        estimatedValueCents: input.estimatedValueCents,
        images: { create: input.imageUrls.map((url, position) => ({ url, position })) },
      },
      include: { images: true },
    });
    res.status(201).json(item);
  })
);

const updateSchema = createSchema.partial().omit({ imageUrls: true });

itemsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const existing = await prisma.item.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Item not found");
    if (existing.ownerId !== req.userId) throw forbidden();
    const item = await prisma.item.update({ where: { id: existing.id }, data: input });
    res.json(item);
  })
);

itemsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.item.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Item not found");
    if (existing.ownerId !== req.userId) throw forbidden();
    await prisma.item.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);
