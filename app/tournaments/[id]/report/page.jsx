'use client';
import {useEffect,useState} from 'react';
import {useParams,useRouter} from 'next/navigation';
import {getSupabaseBrowserClient} from '../../../../lib/supabase/client';
import {getCharacterReportPlacement} from '../../../../lib/tournament-bracket-admin';
import {REPORT_FIGHTERS as fighters} from '../../../../lib/fighter-order';
import {useRef} from 'react';

export default function CharacterReportPage(){
 const {id}=useParams();const router=useRouter();
 const [fighter,setFighter]=useState('マリオ');const [orderedFighters,setOrderedFighters]=useState([]);const touchedFighter=useRef(false);const [color,setColor]=useState('1P');const [characters,setCharacters]=useState([]);
 const [colors,setColors]=useState([]);const [tournament,setTournament]=useState(null);const [player,setPlayer]=useState(null);const [eligible,setEligible]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [saving,setSaving]=useState(false);
 useEffect(()=>{let live=true;(async()=>{try{
 const {data:{session}}=await getSupabaseBrowserClient().auth.getSession();if(!session)throw Error('キャラ報告にはログインが必要です。');
 const mine=JSON.parse(localStorage.getItem('figure-my-colors-'+session.user.id)||'[]');
 const response=await fetch('/api/tournaments?id='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error||'大会を読み込めませんでした。');
 const t=result.tournament;const p=(t?.joinedPlayers||[]).find(p=>!p.isDemo&&String(p.userId||p.id)===String(session.user.id));
 const placement=p?getCharacterReportPlacement(t?.bracket,p.id):null;
 if(live){setTournament(t);setPlayer(p);setColors(mine);setEligible(Boolean(!t?.characterDeclaration&&placement));const saved=t?.characterReports?.[String(p?.id)];if(saved){setCharacters(Array.isArray(saved.characters)?saved.characters:(saved.fighter?[{fighter:saved.fighter,color:saved.color||'1P'}]:[]));}setColor(mine.find(c=>c.fighter==='マリオ')?.color||'1P');}
 // Start optional ranking only after the initial form state is ready.
 if(placement&&!t.characterDeclaration){
 // Ordering is optional; do not block the report form if this fetch fails.
 fetch('/api/stats/fighter-order',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'})
   .then(async res=>res.ok?res.json():null).then(result=>{
     if(!live||!Array.isArray(result?.fighters))return;
     const ranked=[...new Set(result.fighters)].filter(name=>fighters.includes(name));
     setOrderedFighters(ranked);
     if(ranked.length&&!touchedFighter.current){
       setFighter(ranked[0]);
       setColor(mine.find(c=>c.fighter===ranked[0])?.color||'1P');
     }
   }).catch(()=>{});
 }
 }catch(e){if(live)setError(e.message);}finally{if(live)setLoading(false);}})();return()=>{live=false}},[id]);
 const availableFighters=[...orderedFighters,...fighters.filter(name=>!orderedFighters.includes(name))];
 function addCharacter(){const name=fighter;if(!name)return;setCharacters(old=>[...old,{fighter:name,color}]);setColor(colors.find(c=>c.fighter===name)?.color||'1P');}
 function selectFighter(name){touchedFighter.current=true;setFighter(name);setColor(colors.find(c=>c.fighter===name)?.color||'1P');}
 async function submit(e){e.preventDefault();setSaving(true);setError('');try{const {data:{session}}=await getSupabaseBrowserClient().auth.getSession();if(!session)throw Error('ログインが必要です。');const response=await fetch('/api/tournaments/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({id,characters})});const result=await response.json();if(!response.ok)throw Error(result.error||'保存できませんでした。');router.push('/tournaments/'+encodeURIComponent(id));router.refresh();}catch(e){setError(e.message);}finally{setSaving(false)}}
 return <main className="page"><section className="intro"><a className="back-link" href={'/tournaments/'+encodeURIComponent(id)}>← 大会概要に戻る</a><h1>キャラクター報告</h1><p>{tournament?.name||''}</p></section>{loading?<p>読み込み中…</p>:error&&!eligible?<p role="alert">{error}</p>:!eligible?<p>{tournament?.characterDeclaration?'この大会はキャラ宣言を使用しているため、終了後のキャラ報告は不要です。':'準決勝で3位が確定した選手、または決勝を終えた優勝・準優勝選手のうち、1勝以上した選手が報告できます。'}</p>:<section className="my-results my-color-panel"><h2>{player?.name} のキャラ報告</h2><p className="setting-help">使用したキャラクターを追加してから報告してください。</p><div className="my-color-form"><select aria-label="ファイター" value={availableFighters.includes(fighter)?fighter:(availableFighters[0]||'')} onChange={e=>selectFighter(e.target.value)} disabled={!availableFighters.length||saving}>{availableFighters.map(name=><option key={name} value={name}>{name}</option>)}</select><select aria-label="カラー" value={color} onChange={e=>setColor(e.target.value)} disabled={saving}>{['1P','2P','3P','4P','5P','6P','7P','8P'].map(v=><option key={v} value={v}>{v}</option>)}</select><button type="button" className="my-color-add" disabled={!availableFighters.length||saving} onClick={addCharacter}>追加</button></div><div className="my-color-list">{characters.length===0?<p className="setting-help">まだキャラクターが追加されていません。</p>:characters.map((item,index)=><div className="my-color-item" key={index}><span>{item.fighter}　{item.color}</span><button type="button" className="my-color-delete" disabled={saving} onClick={()=>setCharacters(old=>old.filter((_,i)=>i!==index))}>削除</button></div>)}</div><form onSubmit={submit} style={{marginTop:24}}>{error&&<p className="form-error" role="alert">{error}</p>}<button className="submit" type="submit" disabled={saving||characters.length===0}>{saving?'保存中…':'キャラ報告を保存'}</button></form></section>}</main>
}
