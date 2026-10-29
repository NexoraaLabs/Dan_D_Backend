import { z } from "zod";

// Settings -> Push Notifications and Settings -> Trade Preferences. Stored as
// JSON on the user row; anything missing falls back to these defaults, so a
// new toggle only needs adding here.
export const preferencesSchema = z.object({
  push: z.object({
    auctionAlerts: z.boolean(), // "Outbid & ending soon"
    wishlistMatches: z.boolean(), // "When items near you match"
    nearbyTopTrades: z.boolean(), // "Top trades in your area"
    weeklyDigest: z.boolean(),
  }),
  trade: z.object({
    autoAcceptFairTrades: z.boolean(),
    willingToTradeFor: z.array(z.string().trim().min(1).max(40)).max(20), // e.g. "Harley chips", "Patches"
  }),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const defaultPreferences: Preferences = {
  push: { auctionAlerts: true, wishlistMatches: true, nearbyTopTrades: false, weeklyDigest: false },
  trade: { autoAcceptFairTrades: false, willingToTradeFor: [] },
};

export const preferencesPatchSchema = z.object({
  push: preferencesSchema.shape.push.partial().optional(),
  trade: preferencesSchema.shape.trade.partial().optional(),
});

export function readPreferences(stored: unknown): Preferences {
  const value = (stored ?? {}) as Partial<Preferences>;
  return {
    push: { ...defaultPreferences.push, ...value.push },
    trade: { ...defaultPreferences.trade, ...value.trade },
  };
}

export function mergePreferences(stored: unknown, patch: z.infer<typeof preferencesPatchSchema>): Preferences {
  const current = readPreferences(stored);
  return {
    push: { ...current.push, ...patch.push },
    trade: { ...current.trade, ...patch.trade },
  };
}
