ALTER TABLE "albums" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "audio_url" text;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_external_id_unique" UNIQUE("external_id");