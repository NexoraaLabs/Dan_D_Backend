import type { Collection } from "@prisma/client";
import fs from "fs";
import path from "path";
import { prisma } from "../../config/prisma";

export const DEFAULT_COLLECTIONS = [
  { kind: "dealer-chips", name: "Dealer Chips" },
  { kind: "dealer-plates", name: "Dealer Plates" },
  { kind: "dealer-plate-frames", name: "Dealer Plate Frames" },
  { kind: "dealer-key-rings", name: "Dealer Key Rings" },
  { kind: "dip-dots", name: "Dip Dots" },
] as const;

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

/** Creates any of the five default folders the user doesn't have yet. */
export async function ensureDefaultCollections(ownerId: number) {
  const have = await prisma.collection.count({ where: { ownerId, kind: { not: null } } });
  if (have >= DEFAULT_COLLECTIONS.length) return;
  await prisma.collection.createMany({
    data: DEFAULT_COLLECTIONS.map((c) => ({ ownerId, kind: c.kind, name: c.name })),
    skipDuplicates: true,
  });
}

/** Fills in the shipped cover for a default folder that has none of its own. */
export function withCover<T extends Pick<Collection, "kind" | "coverImageUrl">>(collection: T, baseUrl: string): T {
  if (collection.coverImageUrl || !collection.kind) return collection;
  const file = coverFile(collection.kind);
  return file ? { ...collection, coverImageUrl: `${baseUrl}/collection-covers/${file}` } : collection;
}

/** Defaults first in their fixed order, then the user's own, newest first. */
export function sortCollections<T extends Pick<Collection, "kind" | "createdAt">>(collections: T[]) {
  const rank = (c: T) => {
    const i = DEFAULT_COLLECTIONS.findIndex((d) => d.kind === c.kind);
    return i === -1 ? DEFAULT_COLLECTIONS.length : i;
  };
  return [...collections].sort((a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime());
}
