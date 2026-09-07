import { Router } from "express";
import { z } from "zod";
import { ListingType } from "@prisma/client";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";

export const marketplaceRouter = Router();

const listQuerySchema = z.object({
  listingType: z.nativeEnum(ListingType).optional(),
  categoryId: z.coerce.number().int().optional(),
  minPriceCents: z.coerce.number().int().optional(),
  maxPriceCents: z.coerce.number().int().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Screens: Marketplace, Filters
marketplaceRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const where = {
      status: "ACTIVE" as const,
      listingType: q.listingType,
      priceCents: { gte: q.minPriceCents, lte: q.maxPriceCents },
      item: {
        categoryId: q.categoryId,
        title: q.search ? { contains: q.search } : undefined,
      },
    };
    const [listings, total] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where,
        include: { item: { include: { images: true } }, seller: { select: { id: true, username: true, avatarUrl: true } }, auction: true },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.marketplaceListing.count({ where }),
    ]);
    res.json({ listings, total, page: q.page, pageSize: q.pageSize });
  })
);

marketplaceRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id: Number(req.params.id) },
      include: { item: { include: { images: true } }, seller: true, auction: { include: { bids: { orderBy: { amountCents: "desc" }, take: 5 } } } },
    });
    if (!listing) throw notFound("Listing not found");
    res.json(listing);
  })
);

const createSchema = z.object({
  itemId: z.number().int(),
  listingType: z.nativeEnum(ListingType),
  priceCents: z.number().int().positive().optional(),
  auction: z
    .object({
      startPriceCents: z.number().int().positive(),
      bidIncrementCents: z.number().int().positive().default(500),
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date(),
    })
    .optional(),
});

marketplaceRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const item = await prisma.item.findUnique({ where: { id: input.itemId } });
    if (!item) throw notFound("Item not found");
    if (item.ownerId !== req.userId) throw forbidden();
    if (input.listingType === "SALE" && !input.priceCents) throw badRequest("priceCents is required for a SALE listing");
    if (input.listingType === "AUCTION" && !input.auction) throw badRequest("auction details are required for an AUCTION listing");

    const listing = await prisma.marketplaceListing.create({
      data: {
        itemId: item.id,
        sellerId: req.userId!,
        listingType: input.listingType,
        priceCents: input.listingType === "SALE" ? input.priceCents : undefined,
        auction:
          input.listingType === "AUCTION" && input.auction
            ? {
                create: {
                  startPriceCents: input.auction.startPriceCents,
                  currentPriceCents: input.auction.startPriceCents,
                  bidIncrementCents: input.auction.bidIncrementCents,
                  startsAt: input.auction.startsAt,
                  endsAt: input.auction.endsAt,
                  status: input.auction.startsAt <= new Date() ? "LIVE" : "SCHEDULED",
                },
              }
            : undefined,
      },
      include: { auction: true },
    });
    res.status(201).json(listing);
  })
);

marketplaceRouter.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const listing = await prisma.marketplaceListing.findUnique({ where: { id: Number(req.params.id) } });
    if (!listing) throw notFound("Listing not found");
    if (listing.sellerId !== req.userId) throw forbidden();
    const updated = await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { status: "CANCELLED" } });
    res.json(updated);
  })
);
