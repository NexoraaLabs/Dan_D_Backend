import type { Collection } from "@prisma/client";
import fs from "fs";
import path from "path";
import { prisma } from "../../config/prisma";

type DefaultCollection = { kind: string; name: string; parent?: string };

// Parents come before their sub-folders, so they exist by the time the sub-folders are created.
export const DEFAULT_COLLECTIONS: readonly DefaultCollection[] = [
  { kind: "dealer-chips", name: "Dealer Chips" },
  { kind: "dealer-plates", name: "Dealer Plates" },
  { kind: "dealer-plate-frames", name: "Dealer Plate Frames" },
  { kind: "dealer-key-rings", name: "Dealer Key Rings" },
  { kind: "dip-dots", name: "Dip Dots" },
  { kind: "merchandise", name: "Merchandise" },
  { kind: "shirts", name: "Shirts", parent: "merchandise" },
  { kind: "hats", name: "Hats", parent: "merchandise" },
  { kind: "cups", name: "Cups", parent: "merchandise" },
];

export const coversDir = path.resolve("public/collection-covers");

// Covers ship with the backend as public/collection-covers/<kind>.jpg (or .png/.webp).
// Looked up per request so a newly added image shows up without touching the database.
function coverFile(kind: string) {
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const file = `${kind}.${ext}`;
    if (fs.existsSync(path.join(coversDir, file))) return file;
  }
  return null;
}

/** Creates any of the default folders (and sub-folders) the user doesn't have yet. */
export async function ensureDefaultCollections(ownerId: number) {
  const existing = await prisma.collection.findMany({
    where: { ownerId, kind: { not: null } },
    select: { id: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  const missing = DEFAULT_COLLECTIONS.filter((c) => !existing.some((e) => e.kind === c.kind));
  if (missing.length === 0) return;

  const topLevel = missing.filter((c) => !c.parent);
  if (topLevel.length) {
    await prisma.collection.createMany({ data: topLevel.map((c) => ({ ownerId, kind: c.kind, name: c.name })) });
  }
  const subfolders = missing.filter((c) => c.parent);
  if (subfolders.length === 0) return;

  // The oldest of each kind wins, same as sortCollections.
  const parents = await prisma.collection.findMany({
    where: { ownerId, kind: { in: [...new Set(subfolders.map((c) => c.parent!))] } },
    select: { id: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  await prisma.collection.createMany({
    data: subfolders.map((c) => ({
      ownerId,
      kind: c.kind,
      name: c.name,
      parentId: parents.find((p) => p.kind === c.parent)?.id,
    })),
  });
}

/** Fills in the shipped cover for a default folder that has none of its own. */
export function withCover<T extends Pick<Collection, "kind" | "coverImageUrl">>(collection: T, baseUrl: string): T {
  if (collection.coverImageUrl || !collection.kind) return collection;
  const file = coverFile(collection.kind);
  return file ? { ...collection, coverImageUrl: `${baseUrl}/collection-covers/${file}` } : collection;
}

/**
 * Defaults first in their fixed order, then the user's own, newest first. Two first loads at the same
 * moment can each create the defaults, so only the oldest of each kind is kept.
 */
export function sortCollections<T extends Pick<Collection, "kind" | "createdAt">>(collections: T[]) {
  const rank = (c: T) => {
    const i = DEFAULT_COLLECTIONS.findIndex((d) => d.kind === c.kind);
    return i === -1 ? DEFAULT_COLLECTIONS.length : i;
  };
  const seen = new Set<string>();
  return [...collections]
    .sort((a, b) => rank(a) - rank(b) || (a.kind ? a.createdAt.getTime() - b.createdAt.getTime() : b.createdAt.getTime() - a.createdAt.getTime()))
    .filter((c) => !c.kind || (!seen.has(c.kind) && seen.add(c.kind)));
}
