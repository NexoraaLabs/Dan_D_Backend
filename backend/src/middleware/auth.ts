import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { forbidden, unauthorized } from "../utils/httpError";
import { prisma } from "../config/prisma";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

// lastActiveAt feeds the admin "Last Active" column; writing it on every request
// would be wasteful, so it's refreshed at most this often per user.
const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000;

/** Rejects suspended/banned accounts, so an admin action takes effect on the next request rather than at token expiry. */
export async function assertAccountActive(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, lastActiveAt: true } });
  if (!user) throw unauthorized("Account no longer exists");
  if (user.status === "BANNED") throw forbidden("This account has been closed");
  if (user.status === "SUSPENDED") throw forbidden("This account is suspended");
  if (!user.lastActiveAt || Date.now() - user.lastActiveAt.getTime() > LAST_ACTIVE_THROTTLE_MS) {
    await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } });
  }
}

// Express 5 forwards a rejected promise from middleware to the error handler.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Missing bearer token");
  }
  let userId: number;
  try {
    userId = verifyAccessToken(header.slice("Bearer ".length)).sub;
  } catch {
    throw unauthorized("Invalid or expired token");
  }
  await assertAccountActive(userId);
  req.userId = userId;
  next();
}

/** For /api/admin/*: a valid token AND isAdmin, checked against the database each time so revoking admin is immediate. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => undefined);
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { isAdmin: true } });
  if (!user?.isAdmin) throw forbidden("Admin access required");
  next();
}
