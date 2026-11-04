import { prisma } from "../../config/prisma";
import { distanceKm } from "../../utils/geo";
import { HttpError, notFound } from "../../utils/httpError";
import {
  CHECK_IN_COOLDOWN_MS,
  CHECK_IN_RADIUS_M,
  FIRST_CHECK_IN_POINTS,
  REPEAT_CHECK_IN_POINTS,
  lockUser,
  pointsBalance,
  walletSummary,
} from "./points";

// GPS on a phone is often 10-30 m off, so a fix that is reported as imprecise
// gets that much leeway, capped so nobody checks in from down the street.
const MAX_ACCURACY_SLACK_M = 25;

export async function checkIn(input: { userId: number; dealerId: number; lat: number; lng: number; accuracyM?: number }) {
  const dealer = await prisma.dealer.findUnique({ where: { id: input.dealerId } });
  if (!dealer || !dealer.active) throw notFound("Dealer not found");

  const distanceM = distanceKm(input.lat, input.lng, dealer.lat, dealer.lng) * 1000;
  const slack = Math.min(input.accuracyM ?? 0, MAX_ACCURACY_SLACK_M);
  if (distanceM - slack > CHECK_IN_RADIUS_M) {
    throw new HttpError(400, `You need to be within ${CHECK_IN_RADIUS_M} m of ${dealer.name} to check in.`, {
      code: "TOO_FAR",
      distanceM: Math.round(distanceM),
    });
  }

  return prisma.$transaction(async (tx) => {
    await lockUser(tx, input.userId);

    const last = await tx.dealerCheckIn.findFirst({
      where: { userId: input.userId, dealerId: dealer.id },
      orderBy: { createdAt: "desc" },
    });
    if (last && Date.now() - last.createdAt.getTime() < CHECK_IN_COOLDOWN_MS) {
      const nextAt = new Date(last.createdAt.getTime() + CHECK_IN_COOLDOWN_MS);
      throw new HttpError(409, `You already checked in at ${dealer.name} today.`, { code: "ALREADY_CHECKED_IN", nextAt });
    }

    const first = !last;
    const points = first ? FIRST_CHECK_IN_POINTS : REPEAT_CHECK_IN_POINTS;
    const checkIn = await tx.dealerCheckIn.create({
      data: { userId: input.userId, dealerId: dealer.id, points, lat: input.lat, lng: input.lng, distanceM },
    });
    await tx.pointsEntry.create({
      data: {
        userId: input.userId,
        points,
        reason: first ? "CHECK_IN_FIRST" : "CHECK_IN_REPEAT",
        note: dealer.name,
        checkInId: checkIn.id,
      },
    });

    return {
      checkIn: { id: checkIn.id, createdAt: checkIn.createdAt, points, firstVisit: first },
      dealer: { id: dealer.id, name: dealer.name },
      nextCheckInAt: new Date(checkIn.createdAt.getTime() + CHECK_IN_COOLDOWN_MS),
      wallet: walletSummary(await pointsBalance(input.userId, tx)),
    };
  });
}

/** When the user last checked in at each of [dealerIds], for the map's "checked in" state. */
export async function lastCheckIns(userId: number, dealerIds: number[]) {
  if (dealerIds.length === 0) return new Map<number, Date>();
  const rows = await prisma.dealerCheckIn.groupBy({
    by: ["dealerId"],
    where: { userId, dealerId: { in: dealerIds } },
    _max: { createdAt: true },
  });
  return new Map(rows.map((r) => [r.dealerId, r._max.createdAt!]));
}
