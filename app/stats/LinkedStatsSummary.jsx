'use client';
import {useEffect,useState} from 'react';
import {getSupabaseBrowserClient} from '../../lib/supabase/client';
import {getPlayerAchievements} from '../../lib/stats-data';
const aliases={'99450':'145071','118591':'149650','148400':'164481','80108':'142959','100389':'167992','159344':'167992','156108':'156414'};
function canonical(id){let value=String(id),n=0;while(aliases[value]&&n++<10)value=aliases[value];return value;}
export default function LinkedStatsSummary(){const [data,setData]=useState(null),[archive,setArchive]=useState(null),[tag,setTag]=useState('all'),[error,setError]=useState('');
 useEffect(()=>{let active=true;(async()=>{try{const {data:{session}}=await getSupabaseBrowserClient().auth.getSession();if(!session)return;const response=await fetch('/api/stats/my',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error);if(!active)return;setData(result);if(result.legacyPlayerId){const a=await fetch('/api/ningyogeki-archive',{cache:'force-cache'});if(!a.ok)throw Error('過去の人形劇戦績を読み込めませんでした。');const body=await a.json();if(active)setArchive(body.data);}}catch(e){if(active)setError(e.message)}})();return()=>{active=false}},[]);
 if(!data&&!error)return null;
 const current=data?.series?.[tag]||data?.series?.all;
 const legacyId=data?.legacyPlayerId?canonical(data.legacyPlayerId):null;
 const legacy=legacyId&&archive?getPlayerAchievements(archive,legacyId):null;
 const includeLegacy=tag==='all'||tag==='人形劇';
 const wins=(current?.wins||0)+(includeLegacy?(legacy?.matchWins||0):0);
 const losses=(current?.losses||0)+(includeLegacy?(legacy?legacy.matchCount-legacy.matchWins:0):0);
 const championships=(current?.championships||0)+(includeLegacy?(legacy?.tournamentWins||0):0);
 const count=(current?.tournaments||0)+(includeLegacy?(legacy?.tournamentCount||0):0);
 return <section className="linked-stats-summary" style={{maxWidth:1120,margin:'16px auto',padding:'18px',background:'#17131e',color:'#f4f4f6',border:'1px solid #493658',borderRadius:12}}><h2 style={{margin:'0 0 10px'}}>自分の戦績（シリーズ別）</h2>{error&&<p role="alert">{error}</p>}{data&&<><label htmlFor="stats-series-filter">大会シリーズ　</label><select id="stats-series-filter" value={tag} onChange={e=>setTag(e.target.value)} style={{color:'#111',background:'#fff',padding:6}}><option value="all">すべて</option><option value="人形劇">人形劇</option>{data.tags.filter(t=>t!=='人形劇').map(t=><option key={t} value={t}>{t}</option>)}</select><p style={{marginTop:12}}>出場 {count}大会 ／ {wins}勝 {losses}敗 ／ 優勝 {championships}回 ／ 勝率 {wins+losses?((wins/(wins+losses))*100).toFixed(1):'—'}%</p>{data.legacyPlayerId?<p style={{fontSize:12,color:'#bfb6c7'}}>旧スマメイトID：{data.legacyPlayerId}（連携済み）{includeLegacy&&!archive?' ／ 過去戦績を読み込み中':''}</p>:<p style={{fontSize:12,color:'#bfb6c7'}}>過去の人形劇戦績はまだ連携されていません。</p>}<p style={{fontSize:12,color:'#bfb6c7'}}>レートはシリーズ別に維持します。ここでは勝敗・大会数・優勝回数のみ合算します。</p></>}</section>}
