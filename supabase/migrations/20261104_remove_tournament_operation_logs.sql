-- Remove all obsolete match/action/undo logs from tournament rows.
-- Run manually in Supabase SQL Editor only AFTER deploying the updated API
-- and backing up any data you may later want to recover.
-- This update permanently deletes these 3 JSON keys from all tournaments.
-- Only the server-side service role can read this view.
--
-- The view retains current match/stream fields but no history or audit trail.
-- Privacy redaction MUST continue in the server API. Never expose this view
-- directly to browser clients.
BEGIN;

-- The current result/score is in `bracket`; this only drops undo/audit records.
UPDATE public.tournaments
SET data = data - 'matchLogs' - 'adminLog' - 'adminHistory'
WHERE data ?| ARRAY['matchLogs','adminLog','adminHistory'];

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

COMMIT;

-- Historical operation logs cannot be recovered without a separate backup.
-- Bracket scores, match winners, matchState and resultPlacements remain.
