import { NextResponse } from "next/server";
import { z } from "zod";
import { preferencesFor } from "@/lib/notify";
import { updatePreferences } from "@/lib/preferences";
import { readJson, withUser } from "@/lib/http";

const schema = z
  .object({
    timezone: z.string().max(64).refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone").optional(),
    quietStart: z.number().int().min(0).max(23).optional(),
    quietEnd: z.number().int().min(0).max(23).optional(),
    followUps: z.boolean().optional(),
  })
  .strict();

export const GET = withUser(async (_req, user) => NextResponse.json(await preferencesFor(user.id)));

export const PATCH = withUser(async (req, user) => {
  await updatePreferences(user.id, await readJson(req, schema, 4_000));
  return NextResponse.json(await preferencesFor(user.id));
});
