import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";

export const dealersRouter = Router();

const nearbySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusKm: z.coerce.number().default(50),
});

// Haversine distance, filtered in application code. Fine for a dealer
// directory of a few thousand rows; move to a spatial index (MySQL ST_*
// functions, or PostGIS) if the directory grows much larger.
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
