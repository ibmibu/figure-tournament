import { ImageResponse } from 'next/og';
export const runtime = 'edge';
export const alt = 'アミコネ | amiibo大会プラットフォーム';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export default function Image() {
  return new ImageResponse(
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', justifyContent:'center', padding:80, background:'#f5f7fa', color:'#17233a', borderTop:'28px solid #6045a8' }}>
      <div style={{ fontSize:95, fontWeight:900, letterSpacing:3 }}>アミコネ</div>
      <div style={{ width:160, height:9, background:'#6045a8', marginTop:28, marginBottom:34 }} />
      <div style={{ fontSize:40, fontWeight:700 }}>amiibo大会を、もっと楽しく。</div>
      <div style={{ fontSize:27, marginTop:24, color:'#667085' }}>大会の開催・参加・戦績管理</div>
    </div>, size
  );
}
