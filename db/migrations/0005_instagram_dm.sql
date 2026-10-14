CREATE TABLE "instagram_inbound" (
	"mid" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"igsid" text,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instagram_links" ADD CONSTRAINT "instagram_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_links_igsid_uq" ON "instagram_links" USING btree ("igsid");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_links_code_uq" ON "instagram_links" USING btree ("code_hash");