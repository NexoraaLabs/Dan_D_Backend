import fs from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { uploadDir } from "../uploads/uploads.routes";
import { HttpError, badRequest } from "../../utils/httpError";

const notConfigured = () => new HttpError(503, "Chip scanning isn't set up yet. Enter the details by hand.");

// Built on first use so the server still boots before ANTHROPIC_API_KEY is set.
let anthropic: Anthropic | undefined;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY) throw notConfigured();
  return (anthropic ??= new Anthropic());
}

const MODEL = "claude-opus-5-5";

export const ChipScanSchema = z.object({
  isChip: z.boolean().describe("False if the photo does not show a collectible poker/casino chip"),
  title: z.string().describe('Short listing title, e.g. "Harley-Davidson of Bristol $5 Chip"'),
  dealership: z.string().nullable().describe("Dealership, casino or club named on the chip"),
  city: z.string().nullable(),
  state: z.string().nullable().describe("US state or region as printed, e.g. CT"),
  year: z.number().int().nullable().describe("Year printed on the chip, only if visible"),
  denomination: z.string().nullable().describe('Face value as printed, e.g. "$5"'),
  colors: z.array(z.string()).describe("Main body and edge-spot colors"),
  condition: z.enum(["Mint", "Excellent", "Good", "Fair", "Poor"]).nullable(),
  description: z.string().describe("Two or three sentences a collector would put in a listing"),
  confidence: z.enum(["high", "medium", "low"]).describe("How sure you are of the text you read"),
  unreadable: z.string().nullable().describe("Anything you could not read and the user should check"),
});

export type ChipScan = z.infer<typeof ChipScanSchema>;

const SYSTEM = `You read photos of collectible poker chips - mostly Harley-Davidson dealership chips - for a collectors' marketplace app.
Report only what is printed on or visible in the chip. Never invent a year, city or dealership you cannot read; use null instead and say so in "unreadable".
The user will review and correct every field before the chip is saved.`;

const MEDIA_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// Only files this server stored via POST /api/uploads; the URL's host is not trusted.
function uploadedFile(imageUrl: string) {
  let pathname: string;
  try {
    pathname = new URL(imageUrl).pathname;
  } catch {
    throw badRequest("imageUrl must be a URL returned by /api/uploads");
  }
  const match = /^\/uploads\/([a-f0-9]{32}\.[a-z]+)$/.exec(pathname);
  if (!match) throw badRequest("imageUrl must be a URL returned by /api/uploads");
  const ext = path.extname(match[1]);
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) throw badRequest("Chip scan needs a JPEG, PNG or WebP photo");
  return { file: path.join(uploadDir, match[1]), mediaType };
}

export async function scanChip(imageUrl: string): Promise<ChipScan> {
  const { file, mediaType } = uploadedFile(imageUrl);
  let data: string;
  try {
    data = (await fs.readFile(file)).toString("base64");
  } catch {
    throw badRequest("That image is no longer on the server. Upload it again.");
  }

  const client = claude();
  let response;
  try {
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(ChipScanSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: "Read this chip and fill in the listing details." },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("chip scan: ANTHROPIC_API_KEY is invalid");
      throw notConfigured();
    }
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
      throw new HttpError(503, "Chip scanning is busy right now. Try again in a minute.");
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`chip scan: Claude API error ${error.status}: ${error.message}`);
      throw new HttpError(502, "Couldn't read the chip. Enter the details by hand.");
    }
    throw error;
  }

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new HttpError(422, "Couldn't read the chip from that photo. Enter the details by hand.");
  }
  return response.parsed_output;
}
