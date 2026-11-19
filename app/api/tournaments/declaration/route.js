import { REPORT_FIGHTERS } from '../../../../lib/fighter-order';
import { declarationCount, declaredCharacters, validDeclaration } from '../../../../lib/character-declarations';
import { saveTournamentRevision } from '../../../../lib/tournament-save';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function POST(request) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
    const db = admin();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: 'ログインを確認できません。' }, { status: 401 });
    const { id, action, character, color, characters } = await request.json();
    const { data: row, error } = await db.from('tournaments').select('data').eq('id', String(id || '')).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: '大会が見つかりません。' }, { status: 404 });
    const t = row.data;
    if (!t.characterDeclaration || t.declarationPhase !== 'collecting' || t.bracket) return NextResponse.json({ error: '現在はキャラ宣言を受け付けていません。' }, { status: 409 });
    const players = t.joinedPlayers || [];
    const declarations = t.characterDeclarations || {};
    let next;
    if (action === 'submit') {
      const player = players.find(p => !p.isDemo && String(p.userId || p.id) === String(auth.user.id));
      if (!player) return NextResponse.json({ error: '大会参加者のみ宣言できます。' }, { status: 403 });
      if (declarations[String(player.id)]) return NextResponse.json({ error: '宣言済みの内容は変更できません。' }, { status: 409 });
      const submitted = Array.isArray(characters) ? characters :
        (declarationCount(t) === 1 ? [{ fighter: character, color }] : []);
      const entry = { characters: submitted };
      if (!validDeclaration(t, entry, REPORT_FIGHTERS))
        return NextResponse.json({ error: `異なるキャラクターを${declarationCount(t)}キャラ、正しいカラーとともに宣言してください。` }, { status: 400 });
      // Preserve the old 1-character fields for readers of legacy tournaments.
      const normalized = declaredCharacters(entry);
      next = { ...t, characterDeclarations: { ...declarations, [String(player.id)]: {
        character: normalized[0].fighter, color: normalized[0].color,
        characters: normalized,
      } } };
    } else if (action === 'publish') {
      if (t.ownerUserId !== auth.user.id) return NextResponse.json({ error: '主催者のみ公開できます。' }, { status: 403 });
      if (!players.length || players.some(p =>
        !validDeclaration(t, declarations[String(p.id)], REPORT_FIGHTERS)))
        return NextResponse.json({ error: `全員の${declarationCount(t)}キャラ宣言がそろっていません。` }, { status: 409 });
      const reports = { ...(t.characterReports || {}) };
      for (const player of players) {
        const declaration = declarations[String(player.id)];
        reports[String(player.id)] = { characters: declaredCharacters(declaration) };
      }
      next = { ...t, declarationPhase: 'published', characterReports: reports };
    } else return NextResponse.json({ error: '操作が不正です。' }, { status: 400 });
    const { data: updated, error: updateError } = await saveTournamentRevision(db,id,t,next);
    if (updateError) throw updateError;
    if (!updated?.length) return NextResponse.json({ error: '他の操作が先に保存されました。再試行してください。' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Tournament declaration failed:', error);
    return NextResponse.json({ error: '宣言を保存できませんでした。' }, { status: 500 });
  }
}
