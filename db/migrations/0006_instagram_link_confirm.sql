ALTER TABLE "instagram_links" ADD COLUMN "ig_username" text;--> statement-breakpoint
ALTER TABLE "instagram_links" ADD COLUMN "pending_igsid" text;--> statement-breakpoint
ALTER TABLE "instagram_links" ADD COLUMN "pending_username" text;--> statement-breakpoint
ALTER TABLE "instagram_links" ADD COLUMN "pending_at" timestamp with time zone;