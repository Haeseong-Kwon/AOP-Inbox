import { app } from "./app";
import { actions } from "./actions";
import { content } from "./content";
import { home } from "./home";
import { server } from "./server";

/** Korean catalog, keyed by the English source text. Split by area to keep files reviewable. */
export const ko: Record<string, string> = { ...server, ...app, ...content, ...home, ...actions };
