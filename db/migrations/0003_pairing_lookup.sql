-- auth_throttle only held short-lived rate-limit counters (no user data); pairing now limits attempts per code.
DROP TABLE "auth_throttle" CASCADE;--> statement-breakpoint
ALTER TABLE "device_pairings" ADD COLUMN "lookup_id" text;