import {NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {playerTournamentStats,tournamentSeries} from '../../../../lib/series-stats';
export const dynamic='force-dynamic';
export async function GET(request){
 try{
  const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return NextResponse.json({error:'ログインが必要です。'},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const auth=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const {data:{user},error:authError}=await auth.auth.getUser(token);
  if(authError||!user)return NextResponse.json({error:'ログインが必要です。'},{status:401});
  const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const [{data:link,error:linkError},{data:rows,error:rowsError}]=await Promise.all([
   admin.from('legacy_player_links').select('legacy_player_id').eq('user_id',user.id).maybeSingle(),
   admin.from('tournaments').select('data')
  ]);
  if(linkError)throw linkError;if(rowsError)throw rowsError;
  const tournaments=(rows||[]).map(r=>r.data).filter(Boolean);
  const tags=[...new Set(tournaments.flatMap(tournamentSeries))].sort((a,b)=>a.localeCompare(b,'ja'));
  const series=Object.fromEntries(['all',...tags].map(tag=>[tag,playerTournamentStats(tournaments,user.id,tag)]));
  return NextResponse.json({legacyPlayerId:link?.legacy_player_id||null,tags,series},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){console.error('Series stats error',error);return NextResponse.json({error:'戦績を取得できませんでした。設定を確認してください。'},{status:500});}
}
