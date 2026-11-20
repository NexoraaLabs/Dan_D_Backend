import { Router } from "express";
import { z } from "zod";
import { ItemStatus, Prisma, Rarity } from "@prisma/client";
import { asyncHandler } from "../../utils/asyncHandler";
import { optionalUserId, requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { HttpError, badRequest, conflict, forbidden, notFound } from "../../utils/httpError";
import { assertCanAddItem } from "../plans/plan-limit";
import { scanChip } from "./chip-scan";

export const itemsRouter = Router();

// Each scan is a paid Claude call; an in-memory window is enough for one instance.
const SCANS_PER_HOUR = 20;
const recentScans = new Map<number, number[]>();

function takeScanSlot(userId: number) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const times = (recentScans.get(userId) ?? []).filter((t) => t > cutoff);
  if (times.length >= SCANS_PER_HOUR) {
    throw new HttpError(429, `You can scan ${SCANS_PER_HOUR} chips an hour. Try again later or enter the details by hand.`);
  }
  times.push(Date.now());
  recentScans.set(userId, times);
}

const DEALER_FIELDS = { id: true, name: true, address: true, closedAt: true } as const;

async function assertDealerExists(dealerId: number | null | undefined) {
  if (dealerId == null) return;
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { id: true } });
  if (!dealer) throw badRequest("That dealership doesn't exist");
}

const scanSchema = z.object({ imageUrl: z.string().url() });

// Screens: Add Item - Camera Scan -> Item Details Form. Returns suggested
// details only; nothing is saved until the user confirms via POST /api/items.
itemsRouter.post(
  "/scan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { imageUrl } = scanSchema.parse(req.body);
    // No point paying for a scan the user can't save.
    await assertCanAddItem(req.userId!);
    takeScanSlot(req.userId!);
    const suggestion = await scanChip(imageUrl);
    res.json({ imageUrl, suggestion });
  })
);

const listQuerySchema = z.object({
  ownerId: z.coerce.number().int().optional(),
  status: z.nativeEnum(ItemStatus).optional(),
  rarity: z.nativeEnum(Rarity).optional(),
  categoryId: z.coerce.number().int().optional(),
  dealerId: z.coerce.number().int().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Screens: Home / My Profile - Listings / My Profile - Wishlist (status=WANT)
itemsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const viewer = optionalUserId(req);
    const where: Prisma.ItemWhereInput = {
      // Chips in someone else's private collection are left out.
      ...(q.ownerId !== undefined && q.ownerId === viewer ? {} : { OR: [{ collectionId: null }, { collection: { isPrivate: false } }] }),
      ownerId: q.ownerId,
      status: q.status,
      categoryId: q.categoryId,
      dealerId: q.dealerId,
      rarity: q.rarity,
      title: q.search ? { contains: q.search } : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        include: { images: true, category: true, dealer: { select: DEALER_FIELDS } },
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
      include: {
        images: true,
        category: true,
        dealer: { select: DEALER_FIELDS },
        owner: { select: { id: true, username: true, avatarUrl: true } },
        listing: true,
      },
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
  // The dealership the chip comes from; null clears it on PATCH.
  dealerId: z.number().int().nullable().optional(),
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
    await assertDealerExists(input.dealerId);

    const item = await prisma.item.create({
      data: {
        ownerId: req.userId!,
        title: input.title,
        description: input.description,
        status: input.status,
        rarity: input.rarity,
        categoryId: input.categoryId,
        collectionId: input.collectionId,
        dealerId: input.dealerId ?? undefined,
        condition: input.condition,
        brand: input.brand,
        year: input.year,
        estimatedValueCents: input.estimatedValueCents,
        images: { create: input.imageUrls.map((url, position) => ({ url, position })) },
      },
      include: { images: true, dealer: { select: DEALER_FIELDS } },
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
    await assertDealerExists(input.dealerId);
    const item = await prisma.item.update({
      where: { id: existing.id },
      data: input,
      include: { images: true, dealer: { select: DEALER_FIELDS } },
    });
    res.json(item);
  })
);

itemsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.item.findUnique({
      where: { id: Number(req.params.id) },
      include: { listing: { select: { status: true } }, _count: { select: { tradeOfferItems: true, orderItems: true } } },
    });
    if (!existing) throw notFound("Item not found");
    if (existing.ownerId !== req.userId) throw forbidden();
    // Trades and orders keep pointing at the chip, and a live listing would vanish
    // under buyers; say why instead of failing on the foreign key.
    if (existing.listing?.status === "ACTIVE") throw conflict("This chip is listed on the marketplace. End the listing before deleting it.");
    if (existing._count.tradeOfferItems || existing._count.orderItems) {
      throw conflict("This chip is part of a trade or an order, so it can't be deleted.");
    }
    await prisma.item.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);
