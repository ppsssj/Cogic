// Renders one analyzed trace (from trace-analyze output) as an SVG timeline (relative to T0, ms).
const fs=require('fs');const [inp,idx,out,title]=process.argv.slice(2);
const r=JSON.parse(fs.readFileSync(inp,'utf8'))[Number(idx)];const t=r.ts_us;const z=t.T0;
const pts=[['T0 input (pointerdown)',t.T0],['T2 analysisResult received',t.T2],['T3 last graph DOM mutation',t.T3],['T4 2nd rAF callback',t.T4],['T5 graph Paint start',t.T5],['Commit (main→compositor)',t.commit],['DrawFrame #'+r.frameSeq,t.draw],['T6a CompositorFrame submit',t.T6a],['T6b presentation feedback',t.T6b]].filter(p=>p[1]);
const W=1100,H=90+pts.length*34,L=330,R=40;const zoomFrom=t.T2-5000;const span=(t.T6b-zoomFrom)/1000;
const x=v=>L+((v-zoomFrom)/1000)/span*(W-L-R);
let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Segoe UI,Arial" font-size="13"><rect width="100%" height="100%" fill="#fff"/>`;
s+=`<text x="12" y="24" font-size="15" font-weight="600">${title}</text><text x="12" y="44" fill="#555">One Chromium trace clock (µs). Axis: ms relative to T0; window starts 5 ms before T2 (T0→T2 = ${r.ms['T0→T2']} ms, off-axis).</text>`;
pts.forEach(([n,v],i)=>{const y=80+i*34;const rel=((v-z)/1000).toFixed(1);const xx=v<zoomFrom?L:x(v);
s+=`<text x="12" y="${y+4}">${n}</text><line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#eee"/><circle cx="${xx}" cy="${y}" r="5" fill="${i<4?'#2563eb':'#dc2626'}"/><text x="${xx+8}" y="${y-6}" fill="#333">${rel} ms</text>`;});
s+=`</svg>`;fs.writeFileSync(out,s);console.log('wrote',out);
