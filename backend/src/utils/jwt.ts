import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: number; // userId
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.jwtAccessTtl as jwt.SignOptions["expiresIn"] });
}

export function signRefreshToken(payload: { sub: number }): string {
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshTtl as jwt.SignOptions["expiresIn"] });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as unknown as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: number } {
  return jwt.verify(token, env.jwtRefreshSecret) as unknown as { sub: number };
}
