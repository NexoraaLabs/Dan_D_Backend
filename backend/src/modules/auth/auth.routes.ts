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

// Admin dashboard login: same session shape, but only accounts with isAdmin get in.
authRouter.post(
  "/admin/login",
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const session = await authService.login(input, { adminOnly: true });
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

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });

// Screen: Verify Your Email -> "Resend code"
authRouter.post(
  "/verify-email/resend",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ sent: true, ...(await authService.resendVerification(req.userId!)) });
  })
);

// Screen: Enter The Code
authRouter.post(
  "/verify-email",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = codeSchema.parse(req.body);
    await authService.verifyEmail(req.userId!, code);
    res.status(204).send();
  })
);

// Screens: Forgot Password -> Enter OTP (Reset) -> Create New Password.
// Codes are emailed through utils/mailer.ts, which only logs until a provider is chosen.
const emailSchema = z.object({ email: z.string().email() });

authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = emailSchema.parse(req.body);
    res.json({ sent: true, ...(await authService.forgotPassword(email)) });
  })
);

authRouter.post(
  "/forgot-password/verify",
  asyncHandler(async (req, res) => {
    const { email, code } = emailSchema.merge(codeSchema).parse(req.body);
    await authService.verifyResetCode(email, code);
    res.json({ valid: true });
  })
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { email, code, newPassword } = emailSchema.merge(codeSchema).extend({ newPassword: z.string().min(8) }).parse(req.body);
    await authService.resetPassword(email, code, newPassword);
    res.status(204).send();
  })
);
