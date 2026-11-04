# Hybrid tournament records: Supabase writes + GitHub public archive

## Data ownership
- Supabase remains authoritative for tournament creation, join/leave, live
  bracket, stage strikes, score, permissions, account metadata,
  edits and deletes. Fighter/color reports are allowed into the public archive.
- GitHub stores **only explicitly allowlisted public completed results** in
  `public/data/tournament-archive/index.json` and
  `public/data/tournament-archive/tournaments/<id>.json`.
- Do **not** upload raw `tournaments.data` or `profiles` to GitHub.
- Live tournament routes, OBS, and organizer result/report operations remain
  on Supabase. Do not delete Supabase tournament rows during this transition.

## Archival
- `GET /api/archive/export?mode=index` exposes a small *completed-only*
  fingerprint manifest, not raw data. Public CDN caching is 30 seconds.
  Where the existing `tournament_change_signals` table is available, the
  manifest hashes its compact UUID revisions. Older installations fall back
  to projected public metadata; no new SQL is required.
- `GET /api/archive/export?ids=ID1,ID2` (at most 20 IDs) returns allowlisted
  public finished result summary and safely redacted bracket.
- Public finished-event JSON also stores an allowlisted match/statistics snapshot
  for ratings and historical fighter/series calculations. No private player data.
- `Archive completed tournaments` GitHub Action runs every 30 minutes and
  on manual dispatch. It compares fingerprints and only fetches changed events.
  It commits when contents actually differ, to avoid excessive Vercel builds.
- The Action uses the repo-scoped `GITHUB_TOKEN` with `contents: write`;
  **no Vercel or GitHub access token is required in browser JavaScript**.
  Repository settings must permit GitHub Actions to write contents.
- To backfill immediately after production Vercel is Ready:
  Actions > Archive completed tournaments > Run workflow (main).
  If GitHub Actions writes do not initiate a Vercel deployment, deploy the
  resulting GitHub commit in Vercel, or enable the Git integration webhook.

## Reads and resilience
- `/results` and `/players/[id]` read the versioned static archive first.
- Completed event detail pages now use public per-event static JSON when the caller
  is not an organizer and the live DB confirms the tournament is still finished.
  This requires only a small server-side access/overview projection rather
  than downloading the full live bracket from Supabase. Owners, live events,
  missing archive files and older file schemas keep the original full route.
- The small live fingerprint manifest detects results absent from GitHub or
  changed since last sync. Only those finished events are read as public
  deltas from Supabase, so final results needn't wait 30 minutes.
- If static archive or export API is unavailable, existing read-only full
  tournament list fallback preserves functionality, at the cost of egress.
- Home's compact `view=summary`, tournament detail, statistics and character
  reports still use Supabase at this stage; migrate them only after validating
  archive parity and permission-dependent fields.

## Verification before deleting any historical DB data
1. Inspect Actions run logs; ensure the index and per-event files were committed.
2. Compare archive count, event IDs, winner/runner-up/3rd, match scores and
   dates against Supabase for historical samples.
3. Check `/results` for signed-in users and `/players/<id>` for legacy and
   recent events. Confirm new finished results and edits appear immediately via
   the delta fallback.
4. Verify GitHub files contain no emails, friend codes, token fields,
   unannounced declarations or avatar base64. Only explicitly allowlisted
   fighter/color character-report fields may be included.
5. Check Vercel deployment of the scheduled archive commit and Supabase
   Egress over the following event.

**Important**: Public Git history preserves old versions. Removing an event
from the index does not erase earlier commits. Never export secrets or private
reports even temporarily.
