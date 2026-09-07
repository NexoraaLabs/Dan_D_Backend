import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import * as authService from "./auth.service";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(30),
  fullName: z.string().optional(),
});

// Screens: Create Account -> Verify Your Email -> Enter The Code -> Congratulations
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const session = await authService.register(input);
    res.status(201).json(session);
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Screen: Login
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const session = await authService.login(input);
    res.json(session);
  })
);

const refreshSchema = z.object({ refreshToken: z.string() });

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const session = await authService.refresh(refreshToken);
    res.json(session);
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    await authService.logout(req.userId!, refreshToken);
    res.status(204).send();
  })
);

// Screens: Forgot Password -> Enter OTP (Reset) -> Create New Password
// Left as a TODO: needs an email/SMS provider decision (proposal doesn't
// specify one) to actually deliver the OTP.
