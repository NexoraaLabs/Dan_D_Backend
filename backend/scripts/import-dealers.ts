// Loads dealers from a JSON file:
//   [{ externalId?, name, address, lat, lng, phone?, website? }]
// Dry run by default; pass --apply to write. Safe to run again.
//
// Each dealer in the file is matched to a row in the database by externalId,
// or failing that by the same name within 50 km, or by being the nearest
// unmatched dealer within 300 m. That way a dealer added earlier by hand keeps
// its id and check-ins. Matches are updated, the rest are created.
//
// --archive-missing also archives (active = false) every dealer that is not
// in the file. Archived dealers leave the map but keep their check-ins.
//
//   npm run dealers:import -- dealers.json
//   npm run dealers:import -- dealers.json --archive-missing --apply
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();

const dealerSchema = z.object({
  externalId: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
});

const MATCH_RADIUS_KM = 0.3;
const NAME_RADIUS_KM = 50;

// "Kenai Peninsula Harley-Davidson Shop" and "Kenai Peninsula Harley-Davidson"
// are the same dealer: compare names without the brand and filler words.
function nameKey(name: string) {
  return name
    .toLowerCase()
    .replace(/harley[\s-]*davidson|h-d\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["of", "the", "shop", "inc", "llc", "and"].includes(w))
    .join(" ");
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371;
}

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  const archiveMissing = process.argv.includes("--archive-missing");
  if (!file || file.startsWith("--")) {
    console.error("Usage: npm run dealers:import -- <file.json> [--archive-missing] [--apply]");
    process.exit(1);
  }

  const dealers = z.array(dealerSchema).parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const ids = dealers.map((d) => d.externalId).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate externalId in file");

  const existing = await prisma.dealer.findMany({
    select: { id: true, externalId: true, name: true, lat: true, lng: true, active: true },
  });
  const byExternalId = new Map(existing.filter((e) => e.externalId).map((e) => [e.externalId!, e]));
  const taken = new Set<number>();

  // Pass 1: externalId matches, so pass 2 can't hand those rows to someone else.
  const matches = dealers.map((d) => {
    const e = d.externalId ? byExternalId.get(d.externalId) : undefined;
    if (e) taken.add(e.id);
    return e;
  });
  // Pass 2: a free dealer without an externalId that has the same name
  // (within 50 km), or failing that is the nearest one within the radius.
  let byLocation = 0;
  dealers.forEach((d, i) => {
    if (matches[i]) return;
    const free = existing.filter((e) => !taken.has(e.id) && !e.externalId);
    let best = free.find((e) => nameKey(e.name) === nameKey(d.name) && km(e, d) < NAME_RADIUS_KM);
    if (!best) {
      let bestKm = MATCH_RADIUS_KM;
      for (const e of free) {
        const dist = km(e, d);
        if (dist < bestKm) [best, bestKm] = [e, dist];
      }
    }
    if (best) {
      taken.add(best.id);
      matches[i] = best;
      byLocation++;
    }
  });

  const toCreate = dealers.filter((_, i) => !matches[i]);
  const toArchive = archiveMissing ? existing.filter((e) => !taken.has(e.id) && e.active) : [];

  console.log(`${dealers.length} in file, ${existing.length} in database.`);
  console.log(`Update ${taken.size} (${byLocation} matched by location), create ${toCreate.length}, archive ${toArchive.length}.`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write.");
    return;
  }

  const data = (d: z.infer<typeof dealerSchema>) => ({
    externalId: d.externalId ?? null,
    name: d.name,
    address: d.address,
    lat: d.lat,
    lng: d.lng,
    phone: d.phone ?? null,
    website: d.website ?? null,
  });

  await prisma.$transaction(
    async (tx) => {
      for (const [i, d] of dealers.entries()) {
        const m = matches[i];
        if (m) await tx.dealer.update({ where: { id: m.id }, data: { ...data(d), active: true } });
      }
      await tx.dealer.createMany({ data: toCreate.map(data) });
      if (toArchive.length) {
        await tx.dealer.updateMany({ where: { id: { in: toArchive.map((e) => e.id) } }, data: { active: false } });
      }
    },
    { timeout: 120_000 },
  );
  console.log("Done.");
}

main().finally(() => prisma.$disconnect());
