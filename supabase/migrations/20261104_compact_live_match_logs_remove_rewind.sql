-- Remove rollback-only snapshots from the server-only live polling response.
-- This changes only the view: tournaments.data and old history remain intact.
-- Apply manually in Supabase SQL Editor AFTER the app rollback buttons/API
-- have been removed. No table rows are modified.
-- Only the server-side service role can read this view.
--
-- This projection excludes bulky stats snapshots, adminHistory snapshots,
-- and the large `before` payload in old matchLogs, while retaining user-visible
-- log metadata and active match/stream fields.
-- Privacy redaction MUST continue in the server API. Never expose this view
-- directly to browser clients. Enable only after comparison testing.
CREATE OR REPLACE VIEW public.tournament_live_projection
WITH (security_invoker = true)
AS
SELECT
  id,
  created_at,
  owner_token,
  jsonb_build_object(
    'id', data->'id',
    'name', data->'name',
    'date', data->'date',
    'status', data->'status',
    'format', data->'format',
    'bestOf', data->'bestOf',
    'participants', data->'participants',
    'joinedPlayers', data->'joinedPlayers',
    'bracket', data->'bracket',
    'stages', data->'stages',
    'stageRejects', data->'stageRejects',
    'stageSettings', data->'stageSettings',
    'stageActionRevision', data->'stageActionRevision',
    'ownerUserId', data->'ownerUserId',
    'characterDeclaration', data->'characterDeclaration',
    'declarationPhase', data->'declarationPhase',
    'characterDeclarations', data->'characterDeclarations',
    'characterReports', data->'characterReports',
    'streamUrl', data->'streamUrl',
    'streamFriendCode', data->'streamFriendCode',
    'seriesTags', data->'seriesTags',
    'organizerName', data->'organizerName',
    'createdAt', data->'createdAt',
    'completedAt', data->'completedAt',
    'description', data->'description',
    -- Send only display fields. The before snapshots used by the removed
    -- rewind action remain in tournaments.data, but never leave PostgREST.
    'matchLogs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', entry->'id',
        'matchId', entry->'matchId',
        'at', entry->'at',
        'actor', entry->'actor',
        'action', entry->'action'
      ))
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(data->'matchLogs') = 'array'
          THEN data->'matchLogs' ELSE '[]'::jsonb END
      ) AS log(entry)
    ), '[]'::jsonb),
    'adminLog', data->'adminLog',
    'streamMatchId', data->'streamMatchId',
    'streamHoldMatchId', data->'streamHoldMatchId',
    'streamHoldUntil', data->'streamHoldUntil',
    'streamMatchManual', data->'streamMatchManual',
    'resultPlacements', data->'resultPlacements',
    'autoSeed', data->'autoSeed',
    'overlaySettings', data->'overlaySettings'
  ) AS live_data
FROM public.tournaments;

REVOKE ALL ON public.tournament_live_projection FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_live_projection TO service_role;

-- To restore the previous view definition, rerun the earlier
-- 20261104_tournament_live_projection.sql migration. Do not DROP the live view.
