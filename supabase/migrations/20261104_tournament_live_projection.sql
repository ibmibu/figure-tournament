-- Phase 1: optional read-only live projection for tournament traffic.
-- This migration does NOT modify or delete tournaments.data.
-- Run manually in Supabase SQL Editor after taking a backup.
-- Only the server-side service role can read this view.
--
-- This projection excludes bulky stats snapshots, but retains the fields
-- needed by the current live page (including organizer logs and stream settings).
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
    'matchLogs', data->'matchLogs',
    'adminHistory', data->'adminHistory',
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

-- Rollback:
-- DROP VIEW IF EXISTS public.tournament_live_projection;
