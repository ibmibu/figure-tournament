-- Optional one-time cleanup for historical duplicate profile images.
-- Run in Supabase SQL Editor ONLY after deploying the updated API and
-- backing up tournaments.data. This removes the extra avatar copies saved
-- inside each tournament; the page still reads avatars from profiles.
-- Does not alter bracket, scores, results, participant IDs or profile rows.

-- Inspect the amount of redundant data before cleanup:
SELECT
  count(*) AS tournaments_with_avatar_copies,
  ROUND(COALESCE(SUM(octet_length((data->'participantAvatars')::text)), 0) / 1024.0, 1) AS stored_avatar_kb
FROM public.tournaments
WHERE data ? 'participantAvatars';

-- Remove only the redundant top-level avatar map:
BEGIN;

UPDATE public.tournaments
SET data = data - 'participantAvatars'
WHERE data ? 'participantAvatars';

COMMIT;

-- After cleanup, the number of rows with copies should be 0:
SELECT count(*) AS remaining_avatar_copies
FROM public.tournaments
WHERE data ? 'participantAvatars';
