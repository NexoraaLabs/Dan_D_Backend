import { Router } from "express";
import { z } from "zod";
import { ListingType, Prisma, Rarity } from "@prisma/client";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { distanceKm } from "../../utils/geo";

export const marketplaceRouter = Router();

const listQuerySchema = z
  .object({
    listingType: z.nativeEnum(ListingType).optional(),
    categoryId: z.coerce.number().int().optional(),
    rarity: z.nativeEnum(Rarity).optional(),
    minPriceCents: z.coerce.number().int().optional(),
    maxPriceCents: z.coerce.number().int().optional(),
    search: z.string().optional(),
    // The viewer's position; with it every listing gets a distanceKm and radiusKm / sort=nearest work.
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().optional(),
    sort: z.enum(["newest", "price_asc", "price_desc", "nearest"]).default("newest"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), { message: "Send lat and lng together" })
  .refine((q) => (q.sort !== "nearest" && !q.radiusKm) || q.lat !== undefined, {
    message: "sort=nearest and radiusKm need lat and lng",
  });

// Distance search loads this many candidates and filters in memory (see utils/geo.ts).
const DISTANCE_CANDIDATE_CAP = 1000;

const listInclude = {
  item: { include: { images: true, category: true } },
  // lat/lng are only read to compute distanceKm and are stripped before responding.
  seller: { select: { id: true, username: true, avatarUrl: true, lat: true, lng: true } },
  auction: true,
} satisfies Prisma.MarketplaceListingInclude;

type ListRow = Prisma.MarketplaceListingGetPayload<{ include: typeof listInclude }>;

function publicListing(row: ListRow, distance: number | null) {
  const { lat, lng, ...seller } = row.seller;
  return { ...row, seller, distanceKm: distance };
}

// Screens: Marketplace, Filters, Search
marketplaceRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const where: Prisma.MarketplaceListingWhereInput = {
      status: "ACTIVE",
      listingType: q.listingType,
      priceCents: { gte: q.minPriceCents, lte: q.maxPriceCents },
      item: {
        categoryId: q.categoryId,
        rarity: q.rarity,
        title: q.search ? { contains: q.search } : undefined,
      },
    };
    const orderBy: Prisma.MarketplaceListingOrderByWithRelationInput =
      q.sort === "price_asc" ? { priceCents: "asc" } : q.sort === "price_desc" ? { priceCents: "desc" } : { createdAt: "desc" };

    if (q.lat === undefined || q.lng === undefined) {
      const [rows, total] = await Promise.all([
        prisma.marketplaceListing.findMany({ where, include: listInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        prisma.marketplaceListing.count({ where }),
      ]);
      res.json({ listings: rows.map((r) => publicListing(r, null)), total, page: q.page, pageSize: q.pageSize });
      return;
    }

    const { lat, lng } = q;
    const candidates = await prisma.marketplaceListing.findMany({ where, include: listInclude, orderBy, take: DISTANCE_CANDIDATE_CAP });
    let withDistance = candidates.map((r) => ({
      row: r,
      distance: r.seller.lat !== null && r.seller.lng !== null ? distanceKm(lat, lng, r.seller.lat, r.seller.lng) : null,
    }));
    if (q.radiusKm) withDistance = withDistance.filter((x) => x.distance !== null && x.distance <= q.radiusKm!);
    // Sellers without a location sort last.
    if (q.sort === "nearest") withDistance.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    const pageRows = withDistance.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    res.json({
      listings: pageRows.map((x) => publicListing(x.row, x.distance)),
      total: withDistance.length,
      page: q.page,
      pageSize: q.pageSize,
    });
  })
);

marketplaceRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        item: { include: { images: true } },
        // Public fields only: the full row carries passwordHash, email, phone and exact location.
        seller: { select: { id: true, username: true, fullName: true, avatarUrl: true, bio: true, createdAt: true } },
        auction: { include: { bids: { orderBy: { amountCents: "desc" }, take: 5 } } },
      },
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
