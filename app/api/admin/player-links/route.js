import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
function clients(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;return {auth:createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),admin:createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})};}
async function authorize(request){const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return null;const {auth,admin}=clients();const {data:{user}}=await auth.auth.getUser(token);if(!user||!process.env.FIGURE_STATS_ADMIN_USER_ID||user.id!==process.env.FIGURE_STATS_ADMIN_USER_ID)return null;return admin;}
const ALIASES = {'99450':'145071','118591':'149650','148400':'164481','80108':'142959','100389':'167992','159344':'167992','156108':'156414'};
function canonical(id){let value=String(id);const seen=new Set();while(ALIASES[value]&&!seen.has(value)){seen.add(value);value=ALIASES[value];}return value;}
export async function GET(request){
 try {
  const admin=await authorize(request);
  if(!admin)return NextResponse.json({error:'管理者権限が必要です。'},{status:403});
  const [{data:links,error:linkError},{data:profiles,error:profileError},archiveResponse]=await Promise.all([
   admin.from('legacy_player_links').select('legacy_player_id,user_id,created_at').order('created_at',{ascending:false}),
   admin.from('profiles').select('user_id,public_uid,display_name').order('public_uid',{ascending:true}),
   fetch('https://raw.githubusercontent.com/ibmibu/ningyogeki-stats/main/public/data/ningyogeki-archive.json',{next:{revalidate:3600}})
  ]);
  if(linkError)throw linkError;
  if(profileError)throw profileError;
  if(!archiveResponse.ok)throw Error('過去の戦績データを取得できませんでした。');
  const archive=await archiveResponse.json();
  const players=new Map();
  for(const p of archive.players||[]){const id=canonical(p.id);if(!players.has(id))players.set(id,{id,name:p.name||id});}
  const used=new Set((links||[]).map(l=>canonical(l.legacy_player_id)));
  return NextResponse.json({links,players:[...players.values()].filter(p=>!used.has(p.id)).sort((a,b)=>a.name.localeCompare(b.name,'ja')),users:profiles||[]});
 }catch(e){return NextResponse.json({error:e.message},{status:500});}
}
export async function POST(request){try{const admin=await authorize(request);if(!admin)return NextResponse.json({error:'管理者権限が必要です。'},{status:403});const {legacyPlayerId,userId}=await request.json();if(!/^\d+$/.test(String(legacyPlayerId))||!String(userId||'').match(/^[0-9a-f-]{36}$/i))return NextResponse.json({error:'ID形式が正しくありません。'},{status:400});const {data:existing,error:lookupError}=await admin.from('legacy_player_links').select('legacy_player_id,user_id').eq('user_id',targetUserId).maybeSingle();if(lookupError)throw lookupError;if(existing&&existing.legacy_player_id!==String(legacyPlayerId))return NextResponse.json({error:'このアカウントには別の旧IDが連携済みです。'},{status:409});const {error}=await admin.from('legacy_player_links').upsert({legacy_player_id:String(legacyPlayerId),user_id:targetUserId},{onConflict:'legacy_player_id'});if(error)throw error;return NextResponse.json({ok:true});}catch(e){return NextResponse.json({error:e.message},{status:500});}}
export async function DELETE(request){try{const admin=await authorize(request);if(!admin)return NextResponse.json({error:'管理者権限が必要です。'},{status:403});const {legacyPlayerId}=await request.json();const {error}=await admin.from('legacy_player_links').delete().eq('legacy_player_id',String(legacyPlayerId));if(error)throw error;return NextResponse.json({ok:true});}catch(e){return NextResponse.json({error:e.message},{status:500});}}
