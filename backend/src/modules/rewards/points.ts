import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/** 10 points = $1, so one point is worth 10 cents. */
export const CENTS_PER_POINT = 10;

export const CHECK_IN_RADIUS_M = 50;
export const FIRST_CHECK_IN_POINTS = 5;
export const REPEAT_CHECK_IN_POINTS = 1;
export const CHECK_IN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const pointsForCents = (cents: number) => Math.ceil(cents / CENTS_PER_POINT);

export async function pointsBalance(userId: number, db: Db = prisma) {
  const sum = await db.pointsEntry.aggregate({ where: { userId }, _sum: { points: true } });
  return sum._sum.points ?? 0;
}

// Serialises point changes for one user inside a transaction, so two requests
// can't both pass a balance or cooldown check before either writes.
export async function lockUser(tx: Prisma.TransactionClient, userId: number) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

export function walletSummary(points: number) {
  return { points, balanceCents: points * CENTS_PER_POINT, centsPerPoint: CENTS_PER_POINT };
}
