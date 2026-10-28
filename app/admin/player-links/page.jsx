'use client';
import {useEffect,useMemo,useState} from 'react';
import SiteHeader from '../../../components/SiteHeader';
import {getSupabaseBrowserClient} from '../../../lib/supabase/client';
export default function PlayerLinks(){
 const [links,setLinks]=useState([]),[players,setPlayers]=useState([]),[users,setUsers]=useState([]);
 const [legacyPlayerId,setLegacyPlayerId]=useState(''),[publicUid,setPublicUid]=useState('');
 const [query,setQuery]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function request(method,body){
  const {data:{session}}=await getSupabaseBrowserClient().auth.getSession();
  if(!session)throw Error('ログインが必要です。');
  const response=await fetch('/api/admin/player-links',{method,headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const result=await response.json();if(!response.ok)throw Error(result.error||'処理に失敗しました。');return result;
 }
 async function refresh(){try{const result=await request('GET');setLinks(result.links||[]);setPlayers(result.players||[]);setUsers(result.users||[]);setError('');}catch(e){setError(e.message);}}
 useEffect(()=>{refresh();},[]);
 const visible=useMemo(()=>players.filter(p=>p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())||p.id.includes(query)),[players,query]);
 const selected=players.find(p=>p.id===legacyPlayerId);
 async function save(e){e.preventDefault();if(!selected||!publicUid)return;setBusy(true);setError('');setMessage('');try{
  await request('POST',{legacyPlayerId,publicUid:Number(publicUid)});
  setMessage(selected.name+' の戦績を連携しました。');setLegacyPlayerId('');await refresh();
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 async function remove(id){if(!window.confirm('この連携を解除しますか？過去の戦績は削除されません。'))return;try{await request('DELETE',{legacyPlayerId:id});await refresh();setMessage('連携を解除しました。');}catch(e){setError(e.message)}}
 return <main className="page"><SiteHeader/><section className="my-page">
 <h1>選手戦績の連携（管理者用）</h1>
 <p>過去の戦績から選手を選び、アミコネのUIDに紐付けます。連携済みの選手は候補から自動的に消えます。元の戦績は変更しません。</p>
 {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 <section className="profile-panel"><form onSubmit={save} className="profile-edit-form">
 <label htmlFor="legacy-search">過去の選手を検索</label>
 <input id="legacy-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="選手名で検索" />
 <div style={{display:'flex',flexWrap:'wrap',gap:8,maxHeight:250,overflowY:'auto',padding:'10px 0'}} role="group" aria-label="未連携の選手一覧">
 {visible.map(p=><button type="button" key={p.id} aria-pressed={legacyPlayerId===p.id} onClick={()=>setLegacyPlayerId(p.id)} style={{padding:'7px 11px',borderRadius:7,border:legacyPlayerId===p.id?'2px solid #3170b8':'1px solid #d5dce5',background:legacyPlayerId===p.id?'#e7f1fc':'#fff',color:'#172333',cursor:'pointer'}}>{p.name}</button>)}
 {!visible.length&&<p>該当する未連携の選手はいません。</p>}
 </div>
 {selected&&<p>選択中：<strong>{selected.name}</strong>（旧ID：{selected.id}）</p>}
 <label>連携先のアミコネUID
 <select value={publicUid} onChange={e=>setPublicUid(e.target.value)} required>
 <option value="">ユーザーを選択</option>
 {users.filter(u=>u.public_uid!=null&&!links.some(l=>l.user_id===u.user_id)).map(u=><option key={u.user_id} value={u.public_uid}>UID:{String(u.public_uid).padStart(4,'0')} — {u.display_name||'no name'}</option>)}
 </select></label>
 <button className="submit" disabled={busy||!selected||!publicUid} type="submit">{busy?'保存中…':'この選手の戦績を連携'}</button>
 </form></section>
 <section className="my-results"><h2>連携済み選手</h2>
 {links.length?links.map(link=>{const u=users.find(u=>u.user_id===link.user_id);return <div key={link.legacy_player_id} className="tournament-result-item"><span>旧ID：{link.legacy_player_id} → {u?.public_uid!=null?'UID:'+String(u.public_uid).padStart(4,'0'):'登録ユーザー'}</span><button type="button" onClick={()=>remove(link.legacy_player_id)}>解除</button></div>}):<p>連携はまだありません。</p>}
 </section></section></main>;
}
