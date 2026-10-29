import bcrypt from "bcryptjs";
import type { AccountStatus } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "../../config/prisma";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import { badRequest, conflict, forbidden, unauthorized } from "../../utils/httpError";
import { sendEmail } from "../../utils/mailer";
import { env } from "../../config/env";

const TRIAL_DAYS = 15;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;

type CodePurpose = "verify_email" | "reset_password";

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

  // Screen: Verify Your Email -- the code is on its way as soon as the account exists.
  const devCode = await sendCode(user.id, user.email, "verify_email");
  return { ...(await issueSession(user.id, user.email)), ...devCode };
}

export async function login(input: { email: string; password: string }, options: { adminOnly?: boolean } = {}) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw unauthorized("Invalid email or password");

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw unauthorized("Invalid email or password");

  assertCanSignIn(user.status);
  // Same message as a wrong password for non-admins, so the admin login doesn't reveal who has an account.
  if (options.adminOnly && !user.isAdmin) throw unauthorized("Invalid email or password");

  return issueSession(user.id, user.email);
}

function assertCanSignIn(status: AccountStatus) {
  if (status === "BANNED") throw forbidden("This account has been closed");
  if (status === "SUSPENDED") throw forbidden("This account is suspended");
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
  assertCanSignIn(user.status);
  return issueSession(user.id, user.email);
}

export async function logout(userId: number, refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { userId, tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// One-time codes: email verification and password reset
// ---------------------------------------------------------------------------

function hashCode(userId: number, code: string): string {
  return hashToken(`${userId}:${code}`);
}

/** Issues a fresh 6-digit code (superseding any earlier one) and emails it. */
async function sendCode(userId: number, email: string, purpose: CodePurpose) {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.$transaction([
    prisma.verificationCode.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.verificationCode.create({
      data: { userId, purpose, codeHash: hashCode(userId, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    }),
  ]);
  const subject = purpose === "verify_email" ? "Verify your DAN D Collection email" : "Your DAN D Collection reset code";
  await sendEmail({ to: email, subject, text: `Your code is ${code}. It expires in 10 minutes.` });
  return env.exposeDevCodes ? { devCode: code } : {};
}

/** Checks a code against the latest one issued; `consume` marks it used so it can't be replayed. */
async function checkCode(userId: number, purpose: CodePurpose, code: string, consume: boolean) {
  const latest = await prisma.verificationCode.findFirst({
    where: { userId, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!latest || latest.expiresAt < new Date() || latest.attempts >= CODE_MAX_ATTEMPTS) {
    throw badRequest("Code expired. Request a new one.");
  }
  if (latest.codeHash !== hashCode(userId, code)) {
    await prisma.verificationCode.update({ where: { id: latest.id }, data: { attempts: { increment: 1 } } });
    throw badRequest("Incorrect code");
  }
  if (consume) {
    await prisma.verificationCode.update({ where: { id: latest.id }, data: { usedAt: new Date() } });
  }
}

export async function resendVerification(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) throw badRequest("Email is already verified");
  return sendCode(user.id, user.email, "verify_email");
}

export async function verifyEmail(userId: number, code: string) {
  await checkCode(userId, "verify_email", code, true);
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

// Always succeeds from the caller's view, so the endpoint can't be used to probe which emails have accounts.
export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status === "BANNED") return {};
  return sendCode(user.id, user.email, "reset_password");
}

async function userForReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw badRequest("Incorrect code");
  return user;
}

// Screen: Enter OTP (Reset) -- lets the app confirm the code before showing Create New Password.
export async function verifyResetCode(email: string, code: string) {
  const user = await userForReset(email);
  await checkCode(user.id, "reset_password", code, false);
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  const user = await userForReset(email);
  await checkCode(user.id, "reset_password", code, true);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    // Sign out every device: whoever knew the old password shouldn't keep a session.
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
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
