import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { countOnlineFighters, countLegacyFighters, getFighterOrder } from '../../../../lib/fighter-order';
export const dynamic = 'force-dynamic';

// Only return the current authenticated player's past fighter usage order.
export async function GET(request) {
  try {
    const token=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if(!token)return NextResponse.json({error:'ログインが必要です。'},{status:401});
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const auth=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await auth.auth.getUser(token);
    if(authError||!user)return NextResponse.json({error:'ログインが必要です。'},{status:401});
    const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const [{data:rows,error:rowsError},{data:link,error:linkError}]=await Promise.all([
      db.from('tournaments').select('data'),
      db.from('legacy_player_links').select('legacy_player_id').eq('user_id',user.id).maybeSingle(),
    ]);
    if(rowsError||linkError)throw rowsError||linkError;
    const online=countOnlineFighters((rows||[]).map(row=>row.data),user.id);
    let legacy=new Map();
    if(link?.legacy_player_id){
      try {
        const res=await fetch('https://raw.githubusercontent.com/ibmibu/ningyogeki-stats/main/public/data/ningyogeki-archive.json',{next:{revalidate:3600}});
        if(res.ok)legacy=countLegacyFighters(await res.json(),link.legacy_player_id);
      } catch(e) {
        console.warn('Legacy fighter order unavailable',e);
      }
    }
    return NextResponse.json({fighters:getFighterOrder(online,legacy)},{headers:{'Cache-Control':'private, no-store'}});
  } catch(e) {
    console.error('Fighter order failed',e);
    return NextResponse.json({error:'使用キャラ履歴を取得できませんでした。'},{status:500});
  }
}
