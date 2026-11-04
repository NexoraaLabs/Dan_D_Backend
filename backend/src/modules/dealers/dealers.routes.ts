import { Request, Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { distanceKm } from "../../utils/geo";
import { verifyAccessToken } from "../../utils/jwt";
import { requireAuth } from "../../middleware/auth";
import { checkIn, lastCheckIns } from "../rewards/checkins.service";
import { CHECK_IN_COOLDOWN_MS, CHECK_IN_RADIUS_M } from "../rewards/points";

export const dealersRouter = Router();

const nearbySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusKm: z.coerce.number().default(50),
});

// The map works signed out; a valid token only adds the user's check-in state.
function optionalUserId(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  try {
    return verifyAccessToken(header.slice("Bearer ".length)).sub;
  } catch {
    return undefined;
  }
}

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

// Screen: Dealer Ships Ranking. The least-visited dealers come first, so riders
// are pointed at the stops few people have reached.
dealersRouter.get(
  "/ranking",
  asyncHandler(async (_req, res) => {
    const dealers = await prisma.dealer.findMany({
      where: { active: true },
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
