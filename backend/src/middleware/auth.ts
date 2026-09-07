import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { unauthorized } from "../utils/httpError";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Missing bearer token");
  }
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    req.userId = payload.sub;
    next();
  } catch {
    throw unauthorized("Invalid or expired token");
  }
}
