-- Supabase expose le schéma public via son API REST (PostgREST), accessible avec la clé « publishable ».
-- RLS activée sans aucune politique : tout accès par cette API est refusé. L'API Velora se connecte avec le
-- rôle propriétaire des tables, qui n'est pas soumis à RLS : elle n'est pas affectée.
-- Sans effet sur un PostgreSQL classique (local, Docker).
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "genres" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "albums" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tracks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playlists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "favorites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "play_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_cache" ENABLE ROW LEVEL SECURITY;
