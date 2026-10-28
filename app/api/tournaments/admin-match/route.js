import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { updateBracketMatch } from '../../../../lib/tournament-bracket-admin';

export const dynamic = 'force-dynamic';

function client(key) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !key) throw new Error('Supabaseの設定がありません。');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: '主催者としてログインしてください。' }, { status: 401 });
    const auth = client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'ログインの有効期限が切れています。' }, { status: 401 });

    const { id, matchId, action, winnerId, ownerToken } = await request.json();
    if (!id || !['reset', 'forfeit', 'undo'].includes(action) || (action !== 'undo' && !matchId)) {
      return NextResponse.json({ error: '操作内容が正しくありません。' }, { status: 400 });
    }
    const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: row, error: readError } = await admin.from('tournaments')
      .select('data,owner_token').eq('id', String(id)).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });

    const existing = row.data || {};
    const isOwner = existing.ownerUserId
      ? String(existing.ownerUserId) === String(user.id)
      : Boolean(ownerToken && String(ownerToken) === String(row.owner_token));
    if (!isOwner) return NextResponse.json({ error: '対戦結果を変更できるのは大会主催者のみです。' }, { status: 403 });

    let updated;
    try {
      const history = Array.isArray(existing.adminHistory) ? existing.adminHistory : [];
      if (action === 'undo') {
        const latest = history.at(-1);
        if (!latest?.before) throw new Error('巻き戻せる主催者操作がありません。');
        // Never restore a snapshot over bracket progress made by players after the admin action.
        if (JSON.stringify(existing.bracket) !== JSON.stringify(latest.afterBracket)) {
          throw new Error('操作後に対戦が進行したため巻き戻せません。対戦結果を確認してください。');
        }
        updated = {
          ...existing,
          bracket: latest.before.bracket,
          status: latest.before.status,
          resultPlacements: latest.before.resultPlacements,
          completedAt: latest.before.completedAt,
          adminHistory: history.slice(0, -1),
          adminLog: [...(existing.adminLog || []), { at: new Date().toISOString(), label: `巻き戻し：${latest.label}` }].slice(-100),
        };
      } else {
        updated = updateBracketMatch(existing, String(matchId), action, winnerId);
        const match = (existing.bracket?.rounds || []).flat().find(item => String(item.id) === String(matchId));
        const label = action === 'reset'
          ? `結果リセット：${match?.player1?.name || '?'} VS ${match?.player2?.name || '?'}`
          : `不戦勝：${[match?.player1, match?.player2].find(p => String(p?.id) === String(winnerId))?.name || '?'}`;
        const at = new Date().toISOString();
        updated.adminHistory = [...history, {
          at, label,
          before: { bracket: existing.bracket, status: existing.status, resultPlacements: existing.resultPlacements ?? null, completedAt: existing.completedAt ?? null },
          afterBracket: updated.bracket,
        }].slice(-20);
        updated.adminLog = [...(existing.adminLog || []), { at, label }].slice(-100);
      }
    } catch (error) {
      return NextResponse.json({ error: error.message || '対戦結果を変更できませんでした。' }, { status: 400 });
    }

    const { data: changed, error: writeError } = await admin.from('tournaments')
      .update({ data: updated }).eq('id', String(id)).eq('data', JSON.stringify(existing)).select('id');
    if (writeError) throw writeError;
    if (!changed?.length) return NextResponse.json({ error: '別の操作が先に保存されました。再読み込みしてください。' }, { status: 409 });
    const { ownerUserId, ownerId, ...publicTournament } = updated;
    return NextResponse.json({ ok: true, tournament: { ...publicTournament, isOwner: true } });
  } catch (error) {
    console.error('Match administration failed:', error);
    return NextResponse.json({ error: '対戦結果の更新に失敗しました。' }, { status: 500 });
  }
}
