import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";

export const usersRouter = Router();

const publicUserSelect = {
  id: true,
  username: true,
  fullName: true,
  avatarUrl: true,
  bio: true,
  createdAt: true,
};

// Screen: My Profile
usersRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: { plan: true, interests: { include: { category: true } } },
    });
    if (!user) throw notFound("User not found");
    const { passwordHash, ...safe } = user;
    res.json(safe);
  })
);

// Screens: Seller Profile - Tom / User Profile - Tom
usersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.params.id) },
      select: publicUserSelect,
    });
    if (!user) throw notFound("User not found");
    res.json(user);
  })
);

const updateProfileSchema = z.object({
  fullName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(500).optional(),
  phone: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.string().optional(),
});

// Screen: Edit Profile
usersRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.userId! }, data: input });
    const { passwordHash, ...safe } = user;
    res.json(safe);
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

// Screens: Change Password -> Thank You - Password
usersRouter.post(
  "/me/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw unauthorized("Current password is incorrect");
    if (newPassword === currentPassword) throw badRequest("New password must differ from current password");
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.userId! }, data: { passwordHash } });
    res.status(204).send();
  })
);
