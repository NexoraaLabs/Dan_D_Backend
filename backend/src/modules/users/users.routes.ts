import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { mergePreferences, preferencesPatchSchema, readPreferences } from "./preferences";

export const usersRouter = Router();

const publicUserSelect = {
  id: true,
  username: true,
  fullName: true,
  avatarUrl: true,
  bio: true,
  createdAt: true,
};

// The counters on a profile header: Items / Listings / Trades / Collections / Wishlist.
async function profileStats(userId: number) {
  const [items, listings, trades, collections, wishlist] = await Promise.all([
    prisma.item.count({ where: { ownerId: userId } }),
    prisma.marketplaceListing.count({ where: { sellerId: userId, status: "ACTIVE" } }),
    prisma.tradeRequest.count({ where: { status: "COMPLETED", OR: [{ initiatorId: userId }, { recipientId: userId }] } }),
    prisma.collection.count({ where: { ownerId: userId } }),
    prisma.wishlist.count({ where: { userId } }),
  ]);
  return { items, listings, trades, collections, wishlist };
}

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
    res.json({ ...safe, preferences: readPreferences(user.preferences), stats: await profileStats(user.id) });
  })
);

// Screens: Settings -> Push Notifications, Trade Preferences
usersRouter.get(
  "/me/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { preferences: true } });
    res.json(readPreferences(user.preferences));
  })
);

usersRouter.patch(
  "/me/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = preferencesPatchSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { preferences: true } });
    const preferences = mergePreferences(user.preferences, patch);
    await prisma.user.update({ where: { id: req.userId! }, data: { preferences } });
    res.json(preferences);
  })
);

const ACTIVITY_PER_SOURCE = 20;

// Screen: My Activity -- a merged, newest-first timeline built from existing
// rows rather than a separate events table.
usersRouter.get(
  "/me/activity",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const itemSummary = { select: { id: true, title: true, images: { take: 1, orderBy: { position: "asc" as const } } } };
    const [listings, bids, trades, wishlist] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where: { sellerId: userId },
        include: { item: itemSummary },
        orderBy: { createdAt: "desc" },
        take: ACTIVITY_PER_SOURCE,
      }),
      prisma.bid.findMany({
        where: { bidderId: userId },
        include: { auction: { include: { listing: { include: { item: itemSummary } } } } },
        orderBy: { createdAt: "desc" },
        take: ACTIVITY_PER_SOURCE,
      }),
      prisma.tradeRequest.findMany({
        where: { status: "COMPLETED", OR: [{ initiatorId: userId }, { recipientId: userId }] },
        include: {
          initiator: { select: publicUserSelect },
          recipient: { select: publicUserSelect },
        },
        orderBy: { respondedAt: "desc" },
        take: ACTIVITY_PER_SOURCE,
      }),
      prisma.wishlist.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: ACTIVITY_PER_SOURCE }),
    ]);

    const entries = [
      ...listings.map((l) => ({
        type: "listed" as const,
        at: l.createdAt,
        listingType: l.listingType,
        item: l.item,
        listingId: l.id,
      })),
      ...bids.map((b) => ({
        type: "bid" as const,
        at: b.createdAt,
        amountCents: b.amountCents,
        // "Winning" badge: this bid is still the top one.
        winning: b.auction.status !== "ENDED" && b.amountCents === b.auction.currentPriceCents,
        auctionId: b.auctionId,
        item: b.auction.listing.item,
      })),
      ...trades.map((t) => ({
        type: "trade_completed" as const,
        at: t.respondedAt ?? t.createdAt,
        tradeId: t.id,
        with: t.initiatorId === userId ? t.recipient : t.initiator,
      })),
      ...wishlist.map((w) => ({ type: "wishlist_added" as const, at: w.createdAt, wishlistId: w.id, query: w.query })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    res.json(entries.slice(0, 50));
  })
);

const deviceTokenSchema = z.object({ token: z.string().min(10).max(4096), platform: z.enum(["ios", "android", "web"]) });

// Push notifications: the app registers its FCM/APNs token after login. A
// token moves to whoever signed in last on that device.
usersRouter.post(
  "/me/device-tokens",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = deviceTokenSchema.parse(req.body);
    const row = await prisma.deviceToken.upsert({
      where: { token: input.token },
      create: { ...input, userId: req.userId! },
      update: { platform: input.platform, userId: req.userId! },
    });
    res.status(201).json(row);
  })
);

// Called on logout so the device stops receiving this user's pushes.
usersRouter.delete(
  "/me/device-tokens",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string() }).parse(req.body);
    await prisma.deviceToken.deleteMany({ where: { token, userId: req.userId! } });
    res.status(204).send();
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
    res.json({ ...user, stats: await profileStats(user.id) });
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
