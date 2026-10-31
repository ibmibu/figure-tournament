import { CHARACTER_ALIASES } from '../app/stats/data/characterAliases';
import { MANUAL_CHARACTER_REPORTS } from '../app/stats/data/manualCharacterReports';
import { canonicalLegacyId } from './legacy-tournament-converter';

export const REPORT_FIGHTERS = ['マリオ','ドンキーコング','リンク','サムス','ダークサムス','ヨッシー','カービィ','フォックス','ピカチュウ','ルイージ','ネス','キャプテン・ファルコン','プリン','ピーチ','デイジー','クッパ','アイスクライマー','シーク','ゼルダ','ドクターマリオ','ピチュー','ファルコ','マルス','ルキナ','こどもリンク','ガノンドロフ','ミュウツー','ロイ','クロム','Mr.ゲーム＆ウォッチ','メタナイト','ピット','ブラックピット','ゼロスーツサムス','ワリオ','スネーク','アイク','ゼニガメ','フシギソウ','リザードン','ディディーコング','リュカ','ソニック','デデデ','ピクミン＆オリマー','ルカリオ','ロボット','トゥーンリンク','ウルフ','むらびと','ロックマン','Wii Fit トレーナー','ロゼッタ＆チコ','リトル・マック','ゲッコウガ','Mii 格闘タイプ','Mii 剣術タイプ','Mii 射撃タイプ','パルテナ','パックマン','ルフレ','シュルク','クッパJr.','ダックハント','リュウ','ケン','クラウド','カムイ','ベヨネッタ','インクリング','リドリー','シモン','リヒター','キングクルール','しずえ','ガオガエン','パックンフラワー','ジョーカー','勇者','バンジョー＆カズーイ','テリー','ベレト／ベレス','ミェンミェン','スティーブ','セフィロス','ホムラ／ヒカリ','カズヤ','ソラ'];
const supported = new Set(REPORT_FIGHTERS);
const known = [...REPORT_FIGHTERS, 'ポケモントレーナー'];
const norm = s => String(s || '').normalize('NFKC').replace(/\s+/gu, '').trim();
const normTournament = s => String(s || '').normalize('NFKC').replace(/[\s#＃]/gu, '');
const patterns = [
  ...known.map(name => ({ text: name.normalize('NFKC'), name })),
  ...Object.entries(CHARACTER_ALIASES).map(([alias,name]) =>
    ({ text: String(alias).normalize('NFKC'), name: String(name) }))
    .filter(x => x.text && known.includes(x.name)),
].sort((a,b) => b.text.length - a.text.length);
function findExact(text, part) {
  let pos = 0;
  while (pos <= text.length - part.length) {
    const index = text.indexOf(part, pos);
    if (index < 0) return -1;
    const next = text[index + part.length];
    if (!next || !/[A-Za-zぁ-んァ-ヶ一-龯々ー]/u.test(next)) return index;
    pos = index + part.length;
  }
  return -1;
}
function removeExact(text, part) {
  let rest='', pos=0;
  while (pos < text.length) {
    const index=text.indexOf(part,pos);
    if(index<0)return rest+text.slice(pos);
    const next=text[index+part.length];
    if(next && /[A-Za-zぁ-んァ-ヶ一-龯々ー]/u.test(next)){
      rest+=text.slice(pos,index+part.length);pos=index+part.length;
    } else {
      rest+=text.slice(pos,index)+' ';pos=index+part.length;
    }
  }
  return rest;
}
function add(counts, fighters) {
  for(const name of new Set(fighters.map(n=>String(n||'').trim()))) {
    if(supported.has(name)) counts.set(name,(counts.get(name)||0)+1);
  }
}
export function countOnlineFighters(tournaments, userId) {
  const counts=new Map();
  for(const t of tournaments||[]) {
    const final=t?.bracket?.rounds?.at(-1)?.[0];
    if(t?.bracket?.complete!==true || !final?.player1 || !final?.player2 ||
       final.winnerId==null ||
       ![final.player1,final.player2].some(p=>String(p.id)===String(final.winnerId)))continue;
    const p=(t.joinedPlayers||[]).find(p=>!p.isDemo&&String(p.userId||p.id)===String(userId));
    const report=p && t.characterReports?.[String(p.id)];
    if(Array.isArray(report?.characters)) add(counts,report.characters.map(c=>c?.fighter));
  }
  return counts;
}
export function countLegacyFighters(archive,legacyId) {
  const counts=new Map(),source=archive?.data||archive;
  if(!Array.isArray(source?.players)||!Array.isArray(source?.tournaments))return counts;
  const id=canonicalLegacyId(legacyId);
  const player=source.players.find(p=>canonicalLegacyId(p.id)===id);
  if(!player)return counts;
  const name=norm(player.name);
  const byName=new Map(source.tournaments.map(t=>[normTournament(t.name),Number(t.number)]));
  const valid=new Set(source.tournaments.map(t=>Number(t.number)));
  const manual=new Map();
  for(const r of MANUAL_CHARACTER_REPORTS) {
    if(r.playerId ? canonicalLegacyId(r.playerId)!==id : id!=='81727')continue;
    const title=String(r.tournamentName||'');
    const number=byName.get(normTournament(title)) ?? Number(title.match(/人形劇\s*#?\s*(\d+)/u)?.[1]);
    if(!valid.has(number))continue;
    const names=[...new Set((r.characters||[]).filter(Boolean))];
    if(names.length)manual.set(number,names);
  }
  for(const names of manual.values())add(counts,names);
  for(const t of Array.isArray(archive.characterComments)?archive.characterComments:[]) {
    const number=Number(t.number);
    if(!valid.has(number)||manual.has(number))continue;
    const used=new Set();
    for(const comment of t.comments||[]) {
      const userId=String(comment.userId||'').trim();
      if(canonicalLegacyId(userId)!==id && norm(comment.name)!==name)continue;
      let text=String(comment.text||'').normalize('NFKC');
      for(const pat of patterns) {
        if(findExact(text,pat.text)>=0) {
          used.add(pat.name);
          text=removeExact(text,pat.text);
        }
      }
    }
    add(counts,[...used]);
  }
  return counts;
}
export function getFighterOrder(...sources) {
  const totals=new Map();
  for(const source of sources)for(const [name,count] of source) {
    totals.set(name,(totals.get(name)||0)+count);
  }
  return [...totals].filter(([name,n])=>supported.has(name)&&n>0)
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ja'))
    .map(([name])=>name);
}
