// Loads dealers from a JSON file ([{ name, address, lat, lng, phone?, website? }]).
// Dry run by default; pass --apply to write. Dealers already in the database
// (same name within 500 m) are skipped, so it's safe to run again.
//   npm run dealers:import -- data/us-dealers.json
//   npm run dealers:import -- data/us-dealers.json --apply
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();

const dealerSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
});

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371;
}

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!file || file.startsWith("--")) {
    console.error("Usage: npm run dealers:import -- <file.json> [--apply]");
    process.exit(1);
  }

  const dealers = z.array(dealerSchema).parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const existing = await prisma.dealer.findMany({ select: { name: true, lat: true, lng: true } });
  const fresh = dealers.filter((d) => !existing.some((e) => e.name.toLowerCase() === d.name.toLowerCase() && km(e, d) < 0.5));

  console.log(`${dealers.length} in file, ${existing.length} in database, ${fresh.length} new.`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to add them.");
    return;
  }
  const { count } = await prisma.dealer.createMany({ data: fresh });
  console.log(`Added ${count} dealers.`);
}

main().finally(() => prisma.$disconnect());
