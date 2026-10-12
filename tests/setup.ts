import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
// Integration tests never touch the dev database or a real AI provider.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://aop:aop_local_dev@127.0.0.1:54329/aop_inbox_test";
process.env.AI_PROVIDER = "mock";
process.env.META_OEMBED_TOKEN = "";
