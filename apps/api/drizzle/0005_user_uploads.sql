-- Musiques téléversées par les utilisateurs : privées, rattachées à leur propriétaire.
ALTER TABLE "artists" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artists_owner_idx" ON "artists" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "albums_owner_idx" ON "albums" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "tracks_owner_idx" ON "tracks" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playlists_owner_kind_unique" ON "playlists" USING btree ("owner_id","kind");
