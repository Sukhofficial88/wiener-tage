// Схема маршрута: SVG в метрической проекции, без тайлов, поэтому работает офлайн.
import { CTX } from "./data.js";
import { dist } from "./geo.js";
import { t, fmtNum } from "./i18n.js";

const W = 600, H = 460, PAD = 46;
let proj = null;

export function mapSVG(h, pts){
  const lats = pts.map(p=>p.lat), lngs = pts.map(p=>p.lng);
  const cLat = (Math.min(...lats)+Math.max(...lats))/2, cLng = (Math.min(...lngs)+Math.max(...lngs))/2;
  const k = Math.cos(cLat*Math.PI/180), ML = 110574, MG = 111320*k;
  let w = (Math.max(...lngs)-Math.min(...lngs))*MG*1.2, hh = (Math.max(...lats)-Math.min(...lats))*ML*1.2;
  w = Math.max(w, 1500); hh = Math.max(hh, 1000);
  const aw = W-2*PAD, ah = H-2*PAD;
  if(w/hh > aw/ah) hh = w*ah/aw; else w = hh*aw/ah;
  const s = aw/w;
  const P = (lat,lng)=>[W/2+(lng-cLng)*MG*s, H/2-(lat-cLat)*ML*s];
  proj = {P, s};
  const inView = ([x,y], m=0)=>x>m && x<W-m && y>m && y<H-m;
  const path = arr=>arr.map((c,i)=>{ const [x,y] = P(c[0],c[1]); return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1); }).join("");
  const stopXY = pts.map(p=>P(p.lat,p.lng));
  const far = (xy,min)=>stopXY.every(q=>Math.hypot(q[0]-xy[0], q[1]-xy[1]) > min);

  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("mapAria",{title:h.dayTitle})}">
    <defs><clipPath id="clip"><rect width="${W}" height="${H}" rx="2"/></clipPath>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" class="m-grid"/></pattern></defs>
    <rect class="m-bg" width="${W}" height="${H}"/><rect width="${W}" height="${H}" fill="url(#dots)"/>
    <g clip-path="url(#clip)">`;
  CTX.parks.forEach(p=>{ g += `<path class="m-park" d="${path(p.pts)}Z"/>`; });
  g += `<path class="m-water" d="${path(CTX.canal)}"/><path class="m-water" d="${path(CTX.wien)}"/><path class="m-brook" d="${path(CTX.brook)}"/><path class="m-ring" d="${path(CTX.ring)}"/>`;
  CTX.labels.forEach(l=>{ const txt = t("map_"+l.k); const at = l.at.map(c=>P(c[0],c[1])).find(xy=>inView(xy, Math.max(40, txt.length*3.6+6)) && far(xy,40)); if(at) g += `<text class="m-ctx" x="${at[0]}" y="${at[1]}" text-anchor="middle">${txt}</text>`; });
  CTX.parks.forEach(p=>{ const c = P((p.pts[0][0]+p.pts[2][0])/2, (p.pts[0][1]+p.pts[1][1])/2); if(inView(c,30) && far(c,40)) g += `<text class="m-ctx" x="${c[0]}" y="${c[1]+22}" text-anchor="middle">${t("map_"+p.k)}</text>`; });
  CTX.landmarks.forEach(l=>{ const xy = P(l.lat,l.lng); if(inView(xy,24) && far(xy,34)) g += `<circle class="m-lmdot" cx="${xy[0]}" cy="${xy[1]}" r="2.2"/><text class="m-lm" x="${xy[0]+6}" y="${xy[1]+4}">${t("lm_"+l.k)}</text>`; });
  pts.forEach((p,i)=>{ if(!i) return; const a = stopXY[i-1], b = stopXY[i]; g += `<line class="m-route${p.go?" transit":""}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; });
  // Геозоны: пунктирный круг радиуса срабатывания
  pts.forEach((p,i)=>{ const [x,y] = stopXY[i]; g += `<circle class="m-zone" cx="${x}" cy="${y}" r="${Math.max(12,(p.radius||45)*s)}"/>`; });
  g += `</g>`;

  const groups = [];
  pts.forEach((p,i)=>{ const f = groups.find(gr=>dist(gr.p,p) < 25); if(f) f.ids.push(i); else groups.push({p, ids:[i], xy:stopXY[i]}); });
  groups.forEach(gr=>{
    const [x,y] = gr.xy; const label = gr.ids.map(i=>i+1).join("·");
    const wd = label.length > 1 ? 14+label.length*6.5 : 0;
    const shape = wd ? `<rect class="shape" x="${x-wd/2}" y="${y-11}" width="${wd}" height="22" rx="11"/>` : `<circle class="shape" cx="${x}" cy="${y}" r="11"/>`;
    // Подпись справа; если там соседняя точка — слева; если заняты обе стороны — снизу
    const near = (dir)=>groups.some(o=>o !== gr && Math.abs(o.xy[1]-y) < 16 && (dir > 0 ? o.xy[0] > x && o.xy[0]-x < 95 : o.xy[0] < x && x-o.xy[0] < 95));
    let side = x < W-130 ? "r" : "l";
    if(side === "r" && near(1)) side = (x > 100 && !near(-1)) ? "l" : "b";
    else if(side === "l" && near(-1)) side = (x < W-100 && !near(1)) ? "r" : "b";
    const half = wd ? wd/2 : 11;
    const lx = side === "r" ? x+half+6 : side === "l" ? x-half-6 : x;
    g += `<g class="mk" data-i="${gr.ids.join(",")}" tabindex="0" role="button" aria-label="${gr.ids.map(i=>(i+1)+". "+pts[i].title).join("; ")}">
      <circle class="ring" cx="${x}" cy="${y}" r="17"/>
      <circle class="pulse" cx="${x}" cy="${y}" r="12" style="transform-origin:${x}px ${y}px"/>${shape}<text x="${x}" y="${y}">${label}</text>
      <text class="lbl${side==="l"?" end":side==="b"?" mid":""}" x="${lx}" y="${side==="b"?y+26:y+4}">${pts[gr.ids[0]].short}</text></g>`;
  });

  // Я: поверх маркеров, но внутри рамки схемы
  g += `<g clip-path="url(#clip)"><g id="me" class="me" style="display:none"><circle class="me-acc" r="10"/><circle class="me-dot" r="7"/></g></g>`;

  const nice = [50,100,200,250,500,1000,2000];
  const target = 110/s; const m = nice.reduce((a,b)=>Math.abs(b-target) < Math.abs(a-target) ? b : a);
  const sw = m*s, sy = H-18;
  g += `<g><line class="m-scale" x1="16" y1="${sy}" x2="${16+sw}" y2="${sy}"/><line class="m-scale" x1="16" y1="${sy-4}" x2="16" y2="${sy+4}"/><line class="m-scale" x1="${16+sw}" y1="${sy-4}" x2="${16+sw}" y2="${sy+4}"/>
    <text class="m-scale-t" x="${16+sw+6}" y="${sy+4}">${m>=1000?t("u_km",{n:fmtNum(m/1000)}):t("u_m",{n:m})}</text></g>`;
  g += `<g transform="translate(${W-22},24)"><path d="M0 -12 L6 6 L0 2 L-6 6 Z" fill="var(--ink-2)"/><text class="m-north" x="0" y="20" text-anchor="middle">${t("north")}</text></g>`;
  return g + `</svg>`;
}

// Показывает «я» на схеме. Возвращает false, если точка вне схемы.
export function updateMe(pos){
  const me = document.getElementById("me");
  if(!me || !proj) return false;
  if(!pos){ me.style.display = "none"; return false; }
  const [x,y] = proj.P(pos.lat, pos.lng);
  const inside = x > -20 && x < W+20 && y > -20 && y < H+20;
  me.style.display = inside ? "" : "none";
  if(inside){
    me.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    me.querySelector(".me-acc").setAttribute("r", Math.max(10, Math.min(120, (pos.acc||10)*proj.s)).toFixed(1));
  }
  return inside;
}
