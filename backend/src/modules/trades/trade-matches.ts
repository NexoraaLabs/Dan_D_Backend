import { prisma } from "../../config/prisma";

// Screen: Trade Matches. Pairs an item someone else has FOR_TRADE that you
// want ("You Get") with an item of yours they want ("You Give"). Wants come
// from WANT-status items and wishlist entries. Matching is keyword overlap on
// titles plus a category bonus -- the same naive approach as the wishlist
// matcher; swap for a search index once the catalogue grows.

const CANDIDATE_CAP = 500;
const RESULT_LIMIT = 20;

type Want = { text: string; categoryId: number | null };
type Offer = { id: number; title: string; categoryId: number | null };

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/** 0..1: share of the want's keywords found in the offer's title, nudged up for the same category. */
function score(want: Want, offer: Offer): number {
  const wanted = tokens(want.text);
  if (wanted.length === 0) return 0;
  const have = new Set(tokens(offer.title));
  const overlap = wanted.filter((t) => have.has(t)).length / wanted.length;
  if (overlap === 0) return 0;
  const sameCategory = want.categoryId !== null && want.categoryId === offer.categoryId;
  return Math.min(1, overlap * (sameCategory ? 1 : 0.85) + (sameCategory ? 0.1 : 0));
}

function best<T extends Offer>(wants: Want[], offers: T[]): { offer: T; score: number } | null {
  let top: { offer: T; score: number } | null = null;
  for (const offer of offers) {
    for (const want of wants) {
      const s = score(want, offer);
      if (s > (top?.score ?? 0)) top = { offer, score: s };
    }
  }
  return top;
}

async function wantsOf(userIds: number[]) {
  const [wantItems, wishlist] = await Promise.all([
    prisma.item.findMany({ where: { ownerId: { in: userIds }, status: "WANT" }, select: { ownerId: true, title: true, categoryId: true } }),
    prisma.wishlist.findMany({ where: { userId: { in: userIds } }, select: { userId: true, query: true, categoryId: true } }),
  ]);
  const byUser = new Map<number, Want[]>();
  const add = (userId: number, want: Want) => byUser.set(userId, [...(byUser.get(userId) ?? []), want]);
  wantItems.forEach((w) => add(w.ownerId, { text: w.title, categoryId: w.categoryId }));
  wishlist.forEach((w) => add(w.userId, { text: w.query, categoryId: w.categoryId }));
  return byUser;
}

export async function findTradeMatches(userId: number) {
  const myWants = (await wantsOf([userId])).get(userId) ?? [];
  if (myWants.length === 0) return [];

  const itemSelect = {
    id: true,
    title: true,
    categoryId: true,
    rarity: true,
    estimatedValueCents: true,
    images: { take: 1, orderBy: { position: "asc" as const } },
  };
  const [candidates, myOffers] = await Promise.all([
    prisma.item.findMany({
      where: { status: "FOR_TRADE", ownerId: { not: userId }, owner: { status: "ACTIVE" } },
      select: { ...itemSelect, owner: { select: { id: true, username: true, fullName: true, avatarUrl: true } } },
      orderBy: { createdAt: "desc" },
      take: CANDIDATE_CAP,
    }),
    prisma.item.findMany({ where: { ownerId: userId, status: { in: ["FOR_TRADE", "HAVE"] } }, select: itemSelect }),
  ]);

  const gets = candidates
    .map((offer) => ({ offer, score: Math.max(0, ...myWants.map((w) => score(w, offer))) }))
    .filter((g) => g.score > 0);
  if (gets.length === 0) return [];

  const ownerIds = [...new Set(gets.map((g) => g.offer.owner.id))];
  const [theirWants, asInitiator, asRecipient] = await Promise.all([
    wantsOf(ownerIds),
    prisma.tradeRequest.groupBy({
      by: ["initiatorId"],
      where: { status: "COMPLETED", initiatorId: { in: ownerIds } },
      _count: { _all: true },
    }),
    prisma.tradeRequest.groupBy({
      by: ["recipientId"],
      where: { status: "COMPLETED", recipientId: { in: ownerIds } },
      _count: { _all: true },
    }),
  ]);
  const tradesBy = new Map<number, number>();
  asInitiator.forEach((t) => tradesBy.set(t.initiatorId, (tradesBy.get(t.initiatorId) ?? 0) + t._count._all));
  asRecipient.forEach((t) => tradesBy.set(t.recipientId, (tradesBy.get(t.recipientId) ?? 0) + t._count._all));

  return gets
    .map(({ offer, score: getScore }) => {
      const give = best(theirWants.get(offer.owner.id) ?? [], myOffers);
      // You Get is weighted higher: it's what the user asked for.
      const match = Math.round(getScore * 60 + (give?.score ?? 0) * 40);
      const { owner, ...get } = offer;
      return { user: owner, userTrades: tradesBy.get(owner.id) ?? 0, match, get, give: give?.offer ?? null };
    })
    .sort((a, b) => b.match - a.match)
    .slice(0, RESULT_LIMIT);
}
