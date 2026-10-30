CREATE TABLE "instagram_token" (
	"id" text PRIMARY KEY DEFAULT 'bot' NOT NULL,
	"access_token" text NOT NULL,
	"seed_hash" text NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
