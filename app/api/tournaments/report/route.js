import { saveTournamentRevision } from '../../../../lib/tournament-save';
import { getCharacterReportPlacement, repairPrematureAdvances } from '../../../../lib/tournament-bracket-admin';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
export async function POST(request) {
 try {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({error:'ログインが必要です。'},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await auth.auth.getUser(token);
  if(authError||!user)return NextResponse.json({error:'ログインが必要です。'},{status:401});
  const {id,characters}=await request.json();
  const fighters=['マリオ','ドンキーコング','リンク','サムス','ダークサムス','ヨッシー','カービィ','フォックス','ピカチュウ','ルイージ','ネス','キャプテン・ファルコン','プリン','ピーチ','デイジー','クッパ','アイスクライマー','シーク','ゼルダ','ドクターマリオ','ピチュー','ファルコ','マルス','ルキナ','こどもリンク','ガノンドロフ','ミュウツー','ロイ','クロム','Mr.ゲーム＆ウォッチ','メタナイト','ピット','ブラックピット','ゼロスーツサムス','ワリオ','スネーク','アイク','ゼニガメ','フシギソウ','リザードン','ディディーコング','リュカ','ソニック','デデデ','ピクミン＆オリマー','ルカリオ','ロボット','トゥーンリンク','ウルフ','むらびと','ロックマン','Wii Fit トレーナー','ロゼッタ＆チコ','リトル・マック','ゲッコウガ','Mii 格闘タイプ','Mii 剣術タイプ','Mii 射撃タイプ','パルテナ','パックマン','ルフレ','シュルク','クッパJr.','ダックハント','リュウ','ケン','クラウド','カムイ','ベヨネッタ','インクリング','リドリー','シモン','リヒター','キングクルール','しずえ','ガオガエン','パックンフラワー','ジョーカー','勇者','バンジョー＆カズーイ','テリー','ベレト／ベレス','ミェンミェン','スティーブ','セフィロス','ホムラ／ヒカリ','カズヤ','ソラ'];
  if(!Array.isArray(characters)||characters.length<1||characters.length>100||characters.some(c=>!c||!fighters.includes(c.fighter)||!['1P','2P','3P','4P','5P','6P','7P','8P'].includes(c.color)))return NextResponse.json({error:'報告するキャラクター・カラーを確認してください。'},{status:400});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:row,error:readError}=await admin.from('tournaments').select('data').eq('id',String(id)).maybeSingle();
  if(readError)throw readError;
  if(!row)return NextResponse.json({error:'大会が見つかりません。'},{status:404});
  const t=row.data||{};
  if(t.characterDeclaration)return NextResponse.json({error:'キャラ宣言ありの大会では終了後のキャラ報告は不要です。'},{status:409});
  if(!t.bracket?.rounds?.length)return NextResponse.json({error:'大会開始後に報告してください。'},{status:400});
  const player=(t.joinedPlayers||[]).find(p=>!p.isDemo&&String(p.userId||p.id)===String(user.id));
  if(!player)return NextResponse.json({error:'参加者ではありません。'},{status:403});
  // Check eligibility against a corrected read-only bracket. A report save
  // does not overwrite any in-progress match data.
  const placement=getCharacterReportPlacement(repairPrematureAdvances(t).bracket,player.id);
  if(!placement)return NextResponse.json({error:'1勝以上かつ、準決勝敗退または決勝終了で3位以内が確定した選手のみ報告できます。'},{status:403});
  const updated={...t,characterReports:{...(t.characterReports||{}),[String(player.id)]:{characters}}};
  const {data:changed,error:writeError}=await saveTournamentRevision(admin,id,t,updated);
  if(writeError)throw writeError;
  if(!changed?.length)return NextResponse.json({error:'他の更新が先に保存されました。再試行してください。'},{status:409});
  return NextResponse.json({ok:true});
 }catch(e){console.error('Character report save failed:',e);return NextResponse.json({error:'キャラクター報告を保存できませんでした。'},{status:500});}
}
