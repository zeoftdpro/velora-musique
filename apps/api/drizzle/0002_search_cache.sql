CREATE TABLE "search_cache" (
	"provider" text NOT NULL,
	"query" text NOT NULL,
	"track_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_cache_provider_query_pk" PRIMARY KEY("provider","query")
);
