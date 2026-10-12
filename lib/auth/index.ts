import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

const allowedEmails = () =>
  (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  advanced: { cookiePrefix: "aop" },
  databaseHooks: {
    user: {
      create: {
        // Single-owner by default: only allow-listed emails may create an account.
        before: async (user) => {
          if (!allowedEmails().includes(user.email.toLowerCase())) {
            throw new APIError("FORBIDDEN", { message: "Sign-up is limited to invited emails." });
          }
          return { data: user };
        },
      },
    },
  },
  plugins: [nextCookies()],
});
