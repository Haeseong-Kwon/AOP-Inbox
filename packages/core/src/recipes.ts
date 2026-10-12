import { z } from "zod";

/**
 * Verification recipe catalog: the contract. Implementations live in the agent
 * (they need the machine) and may only run fixed, read-only probes — a recipe
 * is never a shell string from the content.
 */
export const RECIPE_CATALOG = {
  "node-installed": { version: 1, description: "Node.js is installed (optionally at least a version)", args: z.object({ minVersion: z.string().regex(/^\d+(\.\d+){0,2}$/).optional() }) },
  "command-exists": { version: 1, description: "A command is on PATH", args: z.object({ command: z.string().regex(/^[\w.+-]{1,64}$/) }) },
  "package-installed": {
    version: 1,
    description: "A package is installed with npm (global or workspace), Homebrew or pip",
    args: z.object({ manager: z.enum(["npm", "npm-global", "brew", "pip"]), name: z.string().regex(/^(@[\w.-]+\/)?[\w.-]+$/) }),
  },
  "file-contains": { version: 1, description: "A file contains a string", args: z.object({ path: z.string().max(400), text: z.string().min(1).max(400) }) },
  "json-key-equals": {
    version: 1,
    description: "A JSON file has a key (dot path) set to a value",
    args: z.object({ path: z.string().max(400), key: z.string().max(200), value: z.string().max(400).optional() }),
  },
  "directory-exists": { version: 1, description: "A directory exists", args: z.object({ path: z.string().max(400) }) },
  "claude-mcp-connected": { version: 1, description: "Claude Code lists the MCP server", args: z.object({ name: z.string().regex(/^[A-Za-z0-9][\w.-]{0,63}$/) }) },
  "http-healthcheck": {
    version: 1,
    description: "A local service answers on localhost",
    args: z.object({ url: z.string().regex(/^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?(\/[\w./-]*)?$/) }),
  },
} as const;

export type RecipeId = keyof typeof RECIPE_CATALOG;
export const RECIPE_IDS = Object.keys(RECIPE_CATALOG) as RecipeId[];

export function validateRecipeArgs(recipe: string, args: Record<string, string>): { ok: true } | { ok: false; error: string } {
  const entry = (RECIPE_CATALOG as Record<string, { args: z.ZodType }>)[recipe];
  if (!entry) return { ok: false, error: `Unknown verification recipe ${recipe}` };
  const parsed = entry.args.safeParse(args);
  return parsed.success ? { ok: true } : { ok: false, error: parsed.error.issues[0]?.message ?? "invalid args" };
}
