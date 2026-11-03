-- Phase 1: optional read-only live projection for tournament traffic.
-- This migration does NOT modify or delete tournaments.data.
-- Run manually in Supabase SQL Editor after taking a backup.
-- Only the server-side service role can read this view.
--
-- The projection deliberately excludes organizer logs, stats snapshots,
-- historical match logs, declarations and contact data. It is NOT yet used
-- by the application; switch reads only after client compatibility testing.
CREATE OR REPLACE VIEW public.tournament_live_projection
WITH (security_invoker = true)
AS
SELECT
  id,
  created_at,
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
    'streamFriendCode', data->'streamFriendCode'
  ) AS live_data
FROM public.tournaments;

REVOKE ALL ON public.tournament_live_projection FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_live_projection TO service_role;

-- Rollback:
-- DROP VIEW IF EXISTS public.tournament_live_projection;
