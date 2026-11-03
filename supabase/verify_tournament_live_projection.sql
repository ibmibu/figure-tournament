-- Read-only verification. Run ONLY AFTER the view migration is installed.
-- No rows are inserted, updated, or deleted.
-- Lists omitted top-level keys and compares approximate JSON payload sizes.
-- Some omissions are intentional (e.g. statsSnapshot); inspect all others
-- before enabling TOURNAMENT_LIVE_PROJECTION_ENABLED.
WITH comparison AS (
  SELECT
    t.id,
    t.data AS full_data,
    p.live_data,
    pg_column_size(t.data) AS full_bytes,
    pg_column_size(p.live_data) AS live_bytes,
    ARRAY(
      SELECT key
      FROM jsonb_object_keys(t.data) AS key
      WHERE NOT (p.live_data ? key)
      ORDER BY key
    ) AS omitted_keys
  FROM public.tournaments t
  LEFT JOIN public.tournament_live_projection p ON p.id = t.id
)
SELECT
  id,
  full_bytes,
  live_bytes,
  ROUND(100.0 * live_bytes / NULLIF(full_bytes, 0), 1) AS live_percent_of_full,
  omitted_keys
FROM comparison
ORDER BY full_bytes DESC
LIMIT 100;

-- Total estimated payload reduction (JSONB storage size, not actual Egress).
SELECT
  COUNT(*) AS tournament_count,
  SUM(pg_column_size(t.data)) AS full_bytes,
  SUM(pg_column_size(p.live_data)) AS live_bytes,
  ROUND(100.0 * SUM(pg_column_size(p.live_data))
    / NULLIF(SUM(pg_column_size(t.data)), 0), 1) AS live_percent_of_full
FROM public.tournaments t
JOIN public.tournament_live_projection p ON p.id = t.id;

-- Compare actual JSON text byte lengths, which are closer to the
-- PostgREST response payload than pg_column_size(jsonb).
-- JSONB internal storage sizes are NOT network transfer sizes.
SELECT
  t.id,
  octet_length(t.data::text) AS full_json_bytes,
  octet_length(p.live_data::text) AS live_json_bytes,
  ROUND(100.0 * octet_length(p.live_data::text)
    / NULLIF(octet_length(t.data::text), 0), 1) AS live_json_percent,
  ARRAY(
    SELECT key FROM jsonb_object_keys(t.data) AS key
    WHERE NOT (p.live_data ? key)
    ORDER BY key
  ) AS omitted_keys
FROM public.tournaments t
JOIN public.tournament_live_projection p ON p.id = t.id
ORDER BY full_json_bytes DESC;

SELECT
  COUNT(*) AS tournament_count,
  SUM(octet_length(t.data::text)) AS full_json_bytes,
  SUM(octet_length(p.live_data::text)) AS live_json_bytes,
  ROUND(100.0 * SUM(octet_length(p.live_data::text))
    / NULLIF(SUM(octet_length(t.data::text)), 0), 1) AS live_json_percent
FROM public.tournaments t
JOIN public.tournament_live_projection p ON p.id = t.id;
