import {NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
export const dynamic='force-dynamic';
export async function PUT(request){try{
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return NextResponse.json({error:'ログインが必要です。'},{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const auth=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
 const {data:{user}}=await auth.auth.getUser(token);
 if(!user||!process.env.FIGURE_STATS_ADMIN_USER_ID||user.id!==process.env.FIGURE_STATS_ADMIN_USER_ID)return NextResponse.json({error:'管理者権限が必要です。'},{status:403});
 const {tournamentId,tags}=await request.json();if(typeof tournamentId!=='string'||!Array.isArray(tags)||tags.length>10)return NextResponse.json({error:'入力が正しくありません。'},{status:400});
 const cleaned=[...new Set(tags.map(x=>String(x).trim()).filter(x=>x.length&&x.length<=40))];if(cleaned.length!==tags.length)return NextResponse.json({error:'タグは重複なし・40文字以内で入力してください。'},{status:400});
 const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:row,error:readError}=await admin.from('tournaments').select('data').eq('id',tournamentId).maybeSingle();if(readError)throw readError;if(!row)return NextResponse.json({error:'大会が見つかりません。'},{status:404});
 const {error}=await admin.from('tournaments').update({data:{...row.data,seriesTags:cleaned}}).eq('id',tournamentId);if(error)throw error;
 return NextResponse.json({ok:true,tags:cleaned});
 }catch(e){console.error(e);return NextResponse.json({error:'タグを保存できませんでした。'},{status:500});}}
