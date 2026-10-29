import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { distanceKm } from "../../utils/geo";

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
    const all = await prisma.dealer.findMany();
    const nearby = all
      .map((d) => ({ ...d, distanceKm: distanceKm(q.lat, q.lng, d.lat, d.lng) }))
      .filter((d) => d.distanceKm <= q.radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
    res.json(nearby);
  })
);
