'use client';
import {useState} from 'react';

export default function Home(){
  const [showForm,setShowForm]=useState(false);
  const [name,setName]=useState('');
  const [format,setFormat]=useState('人形劇');
  return <main className="page">
    <header className="header"><a className="logo" href="/">Figure Tournament</a><button onClick={()=>setShowForm(true)}>大会を作成</button></header>
    <section className="intro"><h1>Figure Tournament</h1><p>amiibo大会の開催・参加・戦績管理</p></section>
    <section className="tournaments"><div className="section-title"><h2>大会一覧</h2><button onClick={()=>setShowForm(true)}>＋ 大会を作成</button></div><div className="empty"><p>大会はまだありません。</p><span>大会を作成すると、ここに表示されます。</span></div></section>
    {showForm&&<div className="overlay" onClick={()=>setShowForm(false)}><section className="dialog" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setShowForm(false)}>×</button><h2>大会を作成</h2><label>大会名<input value={name} onChange={e=>setName(e.target.value)} placeholder="大会名を入力"/></label><label>大会形式<select value={format} onChange={e=>setFormat(e.target.value)}><option>人形劇</option><option>トーナメント</option><option>ルール自由</option></select></label><p className="hint">大会の保存機能はまだ実装されていません。</p><button className="submit" onClick={()=>setShowForm(false)}>閉じる</button></section></div>}
    <footer>Figure Tournament</footer>
  </main>
}
