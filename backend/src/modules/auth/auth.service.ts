import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../../config/prisma";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import { conflict, unauthorized } from "../../utils/httpError";

const TRIAL_DAYS = 15;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function register(input: { email: string; password: string; username: string; fullName?: string }) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
  });
  if (existing) {
    throw conflict("Email or username already in use");
  }

  const freePlan = await prisma.plan.findUnique({ where: { code: "FREE" } });
  const passwordHash = await bcrypt.hash(input.password, 12);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      fullName: input.fullName,
      passwordHash,
      planId: freePlan?.id,
      trialEndsAt,
    },
  });

  return issueSession(user.id, user.email);
}

export async function login(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw unauthorized("Invalid email or password");

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw unauthorized("Invalid email or password");

  return issueSession(user.id, user.email);
}

export async function refresh(refreshToken: string) {
  let payload: { sub: number };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw unauthorized("Invalid refresh token");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findFirst({
    where: { userId: payload.sub, tokenHash, revokedAt: null },
  });
  if (!stored || stored.expiresAt < new Date()) {
    throw unauthorized("Refresh token expired or revoked");
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
  return issueSession(user.id, user.email);
}

export async function logout(userId: number, refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { userId, tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function issueSession(userId: number, email: string) {
  const accessToken = signAccessToken({ sub: userId, email });
  const refreshToken = signRefreshToken({ sub: userId });

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, refreshToken };
}
