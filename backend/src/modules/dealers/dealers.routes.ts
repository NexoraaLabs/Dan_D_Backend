import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { distanceKm } from "../../utils/geo";
import { optionalUserId, requireAuth } from "../../middleware/auth";
import { checkIn, lastCheckIns } from "../rewards/checkins.service";
import { CHECK_IN_COOLDOWN_MS, CHECK_IN_RADIUS_M } from "../rewards/points";

export const dealersRouter = Router();

const nearbySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusKm: z.coerce.number().default(50),
});

// Screens: Map, Map - Dealers List (1/2)
dealersRouter.get(
  "/nearby",
  asyncHandler(async (req, res) => {
    const q = nearbySchema.parse(req.query);
    const all = await prisma.dealer.findMany({ where: { active: true } });
    const nearby = all
      .map((d) => ({ ...d, distanceKm: distanceKm(q.lat, q.lng, d.lat, d.lng) }))
      .filter((d) => d.distanceKm <= q.radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const userId = optionalUserId(req);
    const last = userId ? await lastCheckIns(userId, nearby.map((d) => d.id)) : new Map<number, Date>();
    res.json(
      nearby.map((d) => {
        const at = last.get(d.id);
        return {
          ...d,
          lastCheckInAt: at ?? null,
          nextCheckInAt: at ? new Date(at.getTime() + CHECK_IN_COOLDOWN_MS) : null,
          checkInRadiusM: CHECK_IN_RADIUS_M,
        };
      })
    );
  })
);

const searchSchema = z.object({
  search: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Words that are on almost every dealer's name, so they don't narrow a search.
const FILLER = new Set(["harley", "davidson", "harley-davidson", "h-d", "hd", "of", "the", "shop", "inc", "llc", "and", "&"]);

// Screen: Add Item -> pick the dealership a chip comes from. Every word typed
// must appear in the name or the address, e.g. "bristol" or "kenai soldotna".
dealersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = searchSchema.parse(req.query);
    const words = q.search
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((w) => w && !FILLER.has(w))
      .slice(0, 6);
    const dealers = await prisma.dealer.findMany({
      where: {
        active: true,
        AND: words.map((w) => ({ OR: [{ name: { contains: w } }, { address: { contains: w } }] })),
      },
      // Closed dealers stay pickable: a chip from one is still a chip from that dealer.
      select: { id: true, name: true, address: true, lat: true, lng: true, closedAt: true },
      orderBy: { name: "asc" },
      take: q.limit,
    });
    res.json(dealers);
  })
);

// Screen: Dealer Ships Ranking. The least-visited dealers come first, so riders
// are pointed at the stops few people have reached. Closed ones can't be visited, so they're left out.
dealersRouter.get(
  "/ranking",
  asyncHandler(async (_req, res) => {
    const dealers = await prisma.dealer.findMany({
      where: { active: true, closedAt: null },
      select: { id: true, name: true, address: true, lat: true, lng: true, _count: { select: { checkIns: true } } },
      orderBy: [{ checkIns: { _count: "asc" } }, { name: "asc" }],
      take: 20,
    });
    res.json(
      dealers.map(({ _count, ...d }, i) => ({ rank: i + 1, ...d, checkInCount: _count.checkIns }))
    );
  })
);

const checkInSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).optional(),
});

// Check-in alert -> Check In. 5 points the first time at a dealer, 1 after that,
// at most once per dealer every 24 hours.
dealersRouter.post(
  "/:id/check-in",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = checkInSchema.parse(req.body);
    const result = await checkIn({ userId: req.userId!, dealerId: Number(req.params.id), ...body });
    res.status(201).json(result);
  })
);
