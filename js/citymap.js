// Карта города: настоящие улицы, вода, парки и дома из OpenStreetMap, нарисованные в цветах приложения.
// Данные готовятся заранее (tools/map → data/map/<герой>.json), поэтому карта работает без интернета и без WebGL.
// Во время жеста двигаем готовую картинку (transform), а после жеста перерисовываем её чётко.
import { CTX } from "./data.js";
import { t, fmtNum } from "./i18n.js";

const MAX_S = 4;          // пикселей на метр при самом крупном масштабе
const FOLLOW_S = 1.5;     // масштаб, к которому приближаемся, следуя за человеком
const cache = new Map();

export function loadCityMap(id){
  const pre = window.__WT_MAPDATA && window.__WT_MAPDATA[id];
  if(pre) return Promise.resolve(pre);
  if(!cache.has(id)){
    const p = fetch(`data/map/${id}.json`).then(r=>{ if(!r.ok) throw new Error("map "+r.status); return r.json(); });
    cache.set(id, p); p.catch(()=>cache.delete(id));
  }
  return cache.get(id);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
function decode(d){
  const n = d.match(/-?\d*\.?\d+/g).map(Number), pts = [[n[0], n[1]]];
  for(let i = 2; i + 1 < n.length; i += 2){ const p = pts[pts.length-1]; pts.push([p[0]+n[i], p[1]+n[i+1]]); }
  return pts;
}
let measureCtx = null;
function textWidth(text, font){
  if(!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font; return measureCtx.measureText(text).width;
}
const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

// Подписи улиц вдоль линии: какой шрифт у какого класса
const LABEL = {
  ring:{px:9.5, font:"600 9.5px var(--f-ui)", canvas:"600 9.5px Golos Text, sans-serif", ls:1.3, upper:true, cls:"cm-t-ring"},
  wl1:{px:14, font:"italic 500 14px var(--f-voice)", canvas:"italic 500 14px Cormorant Garamond, serif", ls:.6, cls:"cm-t-water"},
  wl2:{px:12.5, font:"italic 500 12.5px var(--f-voice)", canvas:"italic 500 12.5px Cormorant Garamond, serif", ls:.3, cls:"cm-t-water"},
  r1:{px:10.5, canvas:"600 10.5px Golos Text, sans-serif", cls:"cm-t-major"},
  r2:{px:10.5, canvas:"500 10.5px Golos Text, sans-serif", cls:"cm-t-major"},
  r5:{px:10.5, canvas:"500 10.5px Golos Text, sans-serif", cls:"cm-t-ped"},
  r3:{px:10, canvas:"500 10px Golos Text, sans-serif", cls:"cm-t-minor", minS:.45},
  r4:{px:9.5, canvas:"500 9.5px Golos Text, sans-serif", cls:"cm-t-minor", minS:.9}
};

export function mountCityMap(el, hero, stops, data, opts = {}){
  const [lat0, lng0] = data.o, [MG, ML] = data.m, B = data.b;
  const P = (lat, lng) => [(lng - lng0) * MG, (lat0 - lat) * ML];
  const stopXY = stops.map(s => P(s.lat, s.lng));
  const L = data.l;

  /* ---------- разметка ---------- */
  const lay = (k, cls) => L[k] ? `<path class="${cls||"cm-"+k}" d="${L[k]}"/>` : "";
  const roads = ["r6","r5","r4","r3","r2","r1","ring"];
  const legs = stops.map((s, i) => {
    if(!i) return "";
    const d = data.rt && data.rt[i-1];
    if(d) return `<path class="cm-leg" data-to="${i}" d="${d}"/>`;
    const a = stopXY[i-1], b = stopXY[i];
    if(Math.hypot(a[0]-b[0], a[1]-b[1]) < 5) return "";
    return `<path class="cm-leg transit" data-to="${i}" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}"/>`;
  }).join("");
  const labs = (data.lab || []).map((l, k) => ({...l, id:`cm-lp-${hero.id}-${k}`, pts:decode(l.p)}));
  labs.forEach(l => { delete l.p; });

  el.innerHTML = `
  <div class="cm-stage">
    <svg class="cm-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true">
      <defs>
        <pattern id="cm-vine-${hero.id}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="9" height="9" class="cm-vine-bg"/><circle cx="2" cy="2" r="1.3" class="cm-vine-dot"/></pattern>
      </defs>
      <rect class="cm-sheet" x="${B[0]}" y="${B[1]}" width="${B[2]-B[0]}" height="${B[3]-B[1]}"/>
      <g class="cm-base">
        ${lay("wood")}${lay("park")}${L.vine ? `<path class="cm-vine" fill="url(#cm-vine-${hero.id})" d="${L.vine}"/>` : ""}${lay("cem")}
        ${lay("wl2")}${lay("wl1")}${lay("water")}${lay("sq")}${lay("bldg")}${lay("lmk")}
        ${(data.hb||[]).map(b => `<path class="cm-hb" data-i="${b.i.join(",")}" d="${b.d}"/>`).join("")}
        ${lay("rail")}
        <g class="cm-case">${roads.filter(k => k !== "r6").map(k => lay(k, "c-"+k)).join("")}</g>
        <g class="cm-fill">${roads.map(k => lay(k, "f-"+k)).join("")}</g>
      </g>
      <g class="cm-zones">${stops.map((s, i) => `<circle cx="${stopXY[i][0].toFixed(1)}" cy="${stopXY[i][1].toFixed(1)}" r="${s.radius||45}"/>`).join("")}</g>
      <g class="cm-route"><g class="cm-halo">${legs}</g><g class="cm-line">${legs}</g></g>
      <circle class="cm-acc" r="0" cx="0" cy="0" style="display:none"/>
      <g class="cm-labels"></g>
    </svg>
    <div class="cm-over"></div>
  </div>
  <div class="cm-ctl">
    <button type="button" data-z="1" aria-label="${esc(t("zoomIn"))}">+</button>
    <button type="button" data-z="-1" aria-label="${esc(t("zoomOut"))}">−</button>
    <button type="button" class="cm-loc" aria-label="${esc(t("centerMe"))}" title="${esc(t("centerMe"))}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="1.6"/></svg></button>
  </div>
  <button type="button" class="cm-edge" hidden></button>
  <div class="cm-scale"><i></i><span></span></div>
  <a class="cm-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>`;

  const stage = el.querySelector(".cm-stage"), svg = el.querySelector(".cm-svg"), over = el.querySelector(".cm-over");
  const labG = svg.querySelector(".cm-labels"), acc = svg.querySelector(".cm-acc"), edge = el.querySelector(".cm-edge");
  const scaleI = el.querySelector(".cm-scale i"), scaleT = el.querySelector(".cm-scale span");

  /* ---------- точки маршрута (одинаковые места объединяем: 1·5) ---------- */
  const groups = [];
  stops.forEach((s, i) => {
    const g = groups.find(g => Math.hypot(stopXY[g.ids[0]][0]-stopXY[i][0], stopXY[g.ids[0]][1]-stopXY[i][1]) < 25);
    if(g) g.ids.push(i); else groups.push({ids:[i], xy:stopXY[i]});
  });
  const markers = groups.map(g => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "cm-mk"; b.dataset.i = g.ids.join(",");
    b.setAttribute("aria-label", g.ids.map(i => (i+1)+". "+stops[i].title).join("; "));
    b.innerHTML = `<span class="cm-num">${g.ids.map(i => i+1).join("·")}</span>`;
    const lbl = document.createElement("span"); lbl.className = "cm-mlbl"; lbl.textContent = stops[g.ids[0]].short;
    b.addEventListener("click", e => { e.stopPropagation(); opts.onPick && opts.onPick(g.ids[0]); });
    over.append(lbl, b);
    return {el:b, lbl, g, w:0, lw:0};
  });

  /* ---------- подписи-точки: достопримечательности, станции, площади, парки ---------- */
  const [bx0, by0, bx1, by1] = B;
  const inB = (x, y) => x > bx0 && x < bx1 && y > by0 && y < by1;
  const points = [];
  CTX.landmarks.forEach(l => { const [x, y] = P(l.lat, l.lng); if(inB(x, y)) points.push({x, y, text:t("lm_"+l.k), cls:"cm-lm", pri:1}); });
  (data.st || []).forEach(s => points.push({x:s.x, y:s.y, text:s.t, cls:"cm-st "+(s.k === "u" ? "u" : "s"), icon:s.k === "u" ? "U" : "S", pri:2, minS:.25}));
  (data.pl || []).forEach(p => points.push({x:p.x, y:p.y, text:p.t, cls:"cm-pl k-"+p.k, pri:p.k === "sq" ? 3 : 4, area:p.a}));
  points.forEach(p => {
    const e = document.createElement("span"); e.className = "cm-pt "+p.cls;
    e.innerHTML = p.icon ? `<b>${p.icon}</b><em>${esc(p.text)}</em>` : esc(p.text);
    over.append(e); p.el = e;
  });
  const me = document.createElement("div"); me.className = "cm-me"; me.hidden = true; over.append(me);

  /* ---------- вид ---------- */
  let W = el.clientWidth || 360, H = el.clientHeight || 400;
  const bw = bx1 - bx0, bh = by1 - by0;
  const minS = () => Math.min(W / bw, H / bh) * 0.98;
  const clampV = v => {
    v.s = Math.max(minS(), Math.min(MAX_S, v.s));
    const hw = W / 2 / v.s, hh = H / 2 / v.s;
    v.x = bw / 2 < hw ? (bx0 + bx1) / 2 : Math.max(bx0 + hw, Math.min(bx1 - hw, v.x));
    v.y = bh / 2 < hh ? (by0 + by1) / 2 : Math.max(by0 + hh, Math.min(by1 - hh, v.y));
    return v;
  };
  function fitStops(){
    const xs = stopXY.map(p => p[0]), ys = stopXY.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((W - 90) / Math.max(x1 - x0, 60), (H - 80) / Math.max(y1 - y0, 60), 2.2);
    return clampV({x:(x0 + x1) / 2 + 12 / s, y:(y0 + y1) / 2, s});
  }
  let V = fitStops(), T = {...V};
  let state = {active:-1, visited:new Set(), target:-1}, follow = false, lastPos = null, anim = 0, prevTarget = -1;

  const toPx = (x, y, v = V) => [(x - v.x) * v.s + W / 2, (y - v.y) * v.s + H / 2];

  function applyTransform(){
    const k = T.s / V.s;
    const tx = W / 2 - k * W / 2 + (V.x - T.x) * T.s, ty = H / 2 - k * H / 2 + (V.y - T.y) * T.s;
    stage.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
  }
  function commit(){
    V = {...T}; stage.style.transform = "";
    svg.setAttribute("viewBox", `${V.x - W/2/V.s} ${V.y - H/2/V.s} ${W/V.s} ${H/V.s}`);
    svg.style.setProperty("--px", (1 / V.s) + "px");
    svg.classList.toggle("z-lo", V.s < .5);
    svg.classList.toggle("z-xlo", V.s < .22);
    el.classList.toggle("z-hi", V.s >= 1.2);
    layout(); placeMe(); scaleBar();
  }

  /* ---------- раскладка подписей без наложений ---------- */
  function layout(){
    // кнопки масштаба, линейка и © заняты всегда
    const taken = [[W - 48, 0, W, 112], [0, H - 22, 130, H], [W - 118, H - 18, W, H]];
    const free = box => !taken.some(b => overlap(b, box));
    const onScreen = (x, y, m = 0) => x > -m && x < W + m && y > -m && y < H + m;
    // точки маршрута — главнее всего
    for(const m of markers){
      const [x, y] = toPx(m.g.xy[0], m.g.xy[1]);
      m.el.style.transform = `translate(${x}px,${y}px)`;
      if(!m.w) m.w = m.el.firstChild.offsetWidth || 26;
      taken.push([x - m.w/2 - 2, y - 15, x + m.w/2 + 2, y + 15]);
      m.x = x; m.y = y;
    }
    // подписи точек маршрута: активная и цель первыми, справа или слева
    const order = markers.slice().sort((a, b) => rankM(b) - rankM(a));
    for(const m of order){
      if(!m.lw){ m.lbl.hidden = false; m.lw = m.lbl.offsetWidth || 80; }
      const lh = 20, want = true;
      let box = null, side = "";
      if(want && onScreen(m.x, m.y, 20)){
        const r = [m.x + m.w/2 + 4, m.y - lh/2, m.x + m.w/2 + 4 + m.lw, m.y + lh/2];
        const l = [m.x - m.w/2 - 4 - m.lw, m.y - lh/2, m.x - m.w/2 - 4, m.y + lh/2];
        if(r[2] < W - 4 && free(r)){ box = r; side = "r"; }
        else if(l[0] > 4 && free(l)){ box = l; side = "l"; }
      }
      m.lbl.hidden = !box;
      if(box){ taken.push(box); m.lbl.style.transform = `translate(${box[0]}px,${box[1]}px)`; m.lbl.dataset.side = side; }
    }
    // «я»
    if(lastPos){ const [x, y] = toPx(...P(lastPos.lat, lastPos.lng)); taken.push([x - 10, y - 10, x + 10, y + 10]); }

    // остальное по важности
    const cands = [];
    for(const p of points){
      if(p.minS && V.s < p.minS) continue;
      const [x, y] = toPx(p.x, p.y);
      if(!onScreen(x, y, 40)) continue;
      if(p.area && p.area * V.s * V.s < 2600) continue;
      cands.push({pri:p.pri, kind:"pt", p, x, y});
    }
    for(const l of labs){
      const st = LABEL[l.c]; if(!st) continue;
      if(st.minS && V.s < st.minS) continue;
      cands.push({pri:l.c === "ring" || l.c === "wl1" ? 1.5 : l.c === "r1" || l.c === "r5" ? 2.5 : l.c === "r2" || l.c === "r3" ? 3.5 : 5, kind:"ln", l, st});
    }
    cands.sort((a, b) => a.pri - b.pri);
    let svgOut = "", svgDefs = "", shownNames = new Set(), nLines = 0;
    for(const c of cands){
      if(c.kind === "pt"){
        const p = c.p;
        if(!p.w){ p.el.hidden = false; p.el.classList.add("on"); p.w = p.el.offsetWidth; p.h = p.el.offsetHeight; p.el.classList.remove("on"); }
        const small = p.icon && V.s < .8;  // станция: вдали только значок
        const w = small ? 18 : p.w, h = p.h || 16;
        const box = [c.x - w/2, c.y - h/2, c.x + w/2, c.y + h/2];
        p.show = box[0] > 2 && box[2] < W - 2 && box[1] > 2 && box[3] < H - 2 && free(box);
        if(p.show){ taken.push(box); p.el.style.transform = `translate(${c.x - w/2}px,${c.y - h/2}px)`; p.el.classList.toggle("icon-only", small); }
        continue;
      }
      if(nLines > 40) continue;
      const {l, st} = c;
      if(shownNames.has(l.t)) continue;
      const text = st.upper ? l.t.toUpperCase() : l.t;
      if(!l.tw) l.tw = textWidth(text, st.canvas) + (st.ls || 0) * text.length;
      const need = (l.tw + 14) / V.s;
      if(need > l.n * .95) continue;
      const pad = st.px * .75;
      let box = null;
      const seg = along(l, need, st.px * .45 / V.s, pts => {
        const pb = pts.map(q => toPx(q[0], q[1]));
        box = [Math.min(...pb.map(q => q[0])) - pad, Math.min(...pb.map(q => q[1])) - pad, Math.max(...pb.map(q => q[0])) + pad, Math.max(...pb.map(q => q[1])) + pad];
        return box[0] >= 0 && box[1] >= 0 && box[2] <= W && box[3] <= H && free(box);
      });
      if(!seg) continue;
      taken.push(box); shownNames.add(l.t); nLines++;
      // подпись идёт по прямой между концами участка: так буквы не слипаются на изломах
      const [a, z] = seg.ends, pid = `${l.id}-${nLines}`;
      svgDefs += `<path id="${pid}" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${z[0].toFixed(1)} ${z[1].toFixed(1)}"/>`;
      svgOut += `<text class="${st.cls}" dy=".35em" style="font-size:${st.px / V.s}px${st.ls ? `;letter-spacing:${st.ls / V.s}px` : ""}"><textPath href="#${pid}" xlink:href="#${pid}" startOffset="50%" text-anchor="middle">${esc(text)}</textPath></text>`;
    }
    for(const p of points) p.el.hidden = !p.show, p.show = false;
    labG.innerHTML = `<defs>${svgDefs}</defs>` + svgOut;
  }
  const rankM = m => (m.g.ids.includes(state.active) ? 2 : 0) + (m.g.ids.includes(state.target) ? 1 : 0);

  // Место на линии нужной длины: почти прямое, в кадре и не занятое. Идём от середины к краям.
  function along(l, need, tol, ok){
    if(!l.cum){ l.cum = [0]; for(let i = 1; i < l.pts.length; i++) l.cum.push(l.cum[i-1] + Math.hypot(l.pts[i][0]-l.pts[i-1][0], l.pts[i][1]-l.pts[i-1][1])); }
    const total = l.cum[l.cum.length - 1], room = total - need;
    if(room < 0) return null;
    const step = Math.max(need / 3, 15), mids = [];
    for(let k = 0; k * step <= room / 2 + 1e-6; k++){ mids.push(total / 2 - k * step); if(k) mids.push(total / 2 + k * step); }
    for(const mid of mids){
      const a = Math.max(0, mid - need / 2), b = Math.min(total, mid + need / 2);
      const pts = [pointAt(l, a)];
      for(let i = 0; i < l.pts.length; i++) if(l.cum[i] > a && l.cum[i] < b) pts.push(l.pts[i]);
      pts.push(pointAt(l, b));
      // годится, если участок почти прямой: нет резких углов и он мало отходит от хорды
      let sharp = false;
      for(let i = 2; i < pts.length && !sharp; i++){
        const a1 = Math.atan2(pts[i-1][1]-pts[i-2][1], pts[i-1][0]-pts[i-2][0]), a2 = Math.atan2(pts[i][1]-pts[i-1][1], pts[i][0]-pts[i-1][0]);
        let d = Math.abs(a2 - a1); if(d > Math.PI) d = 2 * Math.PI - d;
        if(d > .45) sharp = true;
      }
      if(sharp) continue;
      const [x0, y0] = pts[0], [x1, y1] = pts[pts.length-1], L = Math.hypot(x1 - x0, y1 - y0) || 1;
      const dev = Math.max(...pts.map(([x, y]) => Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / L));
      if(dev < Math.max(tol, need * .03) && ok(pts)) return {pts, ends:x1 < x0 ? [pts[pts.length-1], pts[0]] : [pts[0], pts[pts.length-1]]};
    }
    return null;
  }
  function pointAt(l, d){
    let i = 1; while(i < l.cum.length - 1 && l.cum[i] < d) i++;
    const f = (d - l.cum[i-1]) / ((l.cum[i] - l.cum[i-1]) || 1);
    return [l.pts[i-1][0] + (l.pts[i][0] - l.pts[i-1][0]) * f, l.pts[i-1][1] + (l.pts[i][1] - l.pts[i-1][1]) * f];
  }

  function scaleBar(){
    const nice = [10,20,50,100,200,250,500,1000,2000,5000];
    const m = nice.reduce((a, b) => Math.abs(b * V.s - 80) < Math.abs(a * V.s - 80) ? b : a);
    scaleI.style.width = Math.round(m * V.s) + "px";
    scaleT.textContent = m >= 1000 ? t("u_km", {n:fmtNum(m / 1000)}) : t("u_m", {n:m});
  }

  /* ---------- «я» ---------- */
  function placeMe(){
    if(!lastPos){ me.hidden = true; acc.style.display = "none"; edge.hidden = true; return; }
    const [wx, wy] = P(lastPos.lat, lastPos.lng);
    const [x, y] = toPx(wx, wy);
    acc.setAttribute("cx", wx.toFixed(1)); acc.setAttribute("cy", wy.toFixed(1));
    acc.setAttribute("r", Math.min(lastPos.acc || 0, 300)); acc.style.display = lastPos.acc ? "" : "none";
    const vis = x > 0 && x < W && y > 0 && y < H;
    me.hidden = !vis;
    if(vis){ me.style.transform = `translate(${x}px,${y}px)`; edge.hidden = true; return; }
    // за краем карты: стрелка у края и расстояние до центра карты
    const dx = x - W / 2, dy = y - H / 2, k = Math.min((W / 2 - 34) / Math.abs(dx || 1e-6), (H / 2 - 22) / Math.abs(dy || 1e-6));
    const d = Math.hypot(wx - V.x, wy - V.y);
    edge.hidden = false;
    edge.style.transform = `translate(${W / 2 + dx * k}px,${H / 2 + dy * k}px) translate(-50%,-50%)`;
    edge.innerHTML = `<i style="transform:rotate(${Math.atan2(dy, dx)}rad)">➜</i>${d >= 1000 ? t("u_km", {n:fmtNum(Math.round(d / 100) / 10)}) : t("u_m", {n:Math.round(d / 10) * 10})}`;
    edge.setAttribute("aria-label", t("centerMe"));
  }

  /* ---------- жесты ---------- */
  const ptrs = new Map();
  let gesture = null, commitTimer = 0, lastTap = 0;
  function zoomAt(px, py, s){
    const wx = T.x + (px - W / 2) / T.s, wy = T.y + (py - H / 2) / T.s;
    T.s = Math.max(minS(), Math.min(MAX_S, s));
    T.x = wx - (px - W / 2) / T.s; T.y = wy - (py - H / 2) / T.s;
    clampV(T);
  }
  const rel = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function stopAnim(){ if(anim){ cancelAnimationFrame(anim); anim = 0; } }
  function onDown(e){
    if(e.target.closest(".cm-mk,.cm-ctl,.cm-edge,.cm-attr")) return;
    stopAnim();
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
    ptrs.set(e.pointerId, rel(e));
    gesture = {moved:false, start:rel(e), time:Date.now()};
  }
  function onMove(e){
    if(!ptrs.has(e.pointerId)) return;
    const prev = [...ptrs.values()], p = rel(e);
    ptrs.set(e.pointerId, p);
    const now = [...ptrs.values()];
    if(now.length === 1){
      const dx = p[0] - prev[0][0], dy = p[1] - prev[0][1];
      if(!gesture.moved && Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) < 4) return;
      gesture.moved = true; follow = false;
      T.x -= dx / T.s; T.y -= dy / T.s; clampV(T);
    } else if(now.length >= 2 && prev.length >= 2){
      const c0 = [(prev[0][0] + prev[1][0]) / 2, (prev[0][1] + prev[1][1]) / 2], c1 = [(now[0][0] + now[1][0]) / 2, (now[0][1] + now[1][1]) / 2];
      const d0 = Math.hypot(prev[0][0] - prev[1][0], prev[0][1] - prev[1][1]) || 1, d1 = Math.hypot(now[0][0] - now[1][0], now[0][1] - now[1][1]) || 1;
      gesture.moved = true; follow = false;
      T.x -= (c1[0] - c0[0]) / T.s; T.y -= (c1[1] - c0[1]) / T.s;
      zoomAt(c1[0], c1[1], T.s * d1 / d0);
    }
    applyTransform();
  }
  function onUp(e){
    if(!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if(ptrs.size) return;
    if(gesture && gesture.moved){ commit(); return; }
    // двойное касание — приблизить
    const now = Date.now();
    if(now - lastTap < 320){ const [px, py] = rel(e); animateTo(zoomTarget(px, py, T.s * 2)); lastTap = 0; }
    else lastTap = now;
  }
  function zoomTarget(px, py, s){ const save = {...T}; zoomAt(px, py, s); const v = {...T}; T = save; return v; }
  function onWheel(e){
    e.preventDefault(); stopAnim();
    const [px, py] = rel(e);
    zoomAt(px, py, T.s * Math.exp(-e.deltaY * (e.deltaMode === 1 ? .05 : .0022)));
    applyTransform();
    clearTimeout(commitTimer); commitTimer = setTimeout(commit, 160);
  }
  function animateTo(to, ms = 450){
    stopAnim(); clampV(to);
    const from = {...T}, t0 = performance.now();
    if(Math.hypot((to.x - from.x) * to.s, (to.y - from.y) * to.s) > W * 3){ T = to; commit(); return; }
    const step = now => {
      const f = Math.min(1, (now - t0) / ms), e = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      const ls = Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e;
      T = {x:from.x + (to.x - from.x) * e, y:from.y + (to.y - from.y) * e, s:Math.exp(ls)};
      applyTransform();
      if(f < 1) anim = requestAnimationFrame(step); else { anim = 0; T = {...to}; commit(); }
    };
    anim = requestAnimationFrame(step);
  }
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, {passive:false});
  el.addEventListener("dblclick", e => e.preventDefault());
  el.querySelectorAll("[data-z]").forEach(b => b.addEventListener("click", () => animateTo({...T, s:T.s * (b.dataset.z > 0 ? 2 : .5)}, 300)));
  el.querySelector(".cm-loc").addEventListener("click", () => opts.onLocate && opts.onLocate());
  edge.addEventListener("click", () => opts.onLocate && opts.onLocate());

  const ro = new ResizeObserver(() => {
    const w = el.clientWidth, h = el.clientHeight;
    if(!w || !h || (w === W && h === H)) return;
    W = w; H = h; clampV(T); commit();
  });
  ro.observe(el);
  el.classList.add("cm");
  commit();
  // шрифты могут догрузиться позже: перемеряем подписи
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => { markers.forEach(m => { m.w = m.lw = 0; }); points.forEach(p => { p.w = 0; }); labs.forEach(l => { l.tw = 0; }); if(el.isConnected) commit(); });

  function nearMap(pos){ const [x, y] = P(pos.lat, pos.lng); return x > bx0 - 300 && x < bx1 + 300 && y > by0 - 300 && y < by1 + 300; }
  // Следуя за человеком, держим в кадре и его, и следующую точку маршрута
  function centerOn(pos){
    const [x, y] = P(pos.lat, pos.lng);
    const tg = stopXY[state.target];
    if(tg){
      const x0 = Math.min(x, tg[0]), x1 = Math.max(x, tg[0]), y0 = Math.min(y, tg[1]), y1 = Math.max(y, tg[1]);
      const s = Math.min(FOLLOW_S, (W - 100) / Math.max(x1 - x0, 1), (H - 110) / Math.max(y1 - y0, 1));
      if(s >= .12){ glide({x:(x0 + x1) / 2, y:(y0 + y1) / 2, s}); return; }
    }
    glide({x, y, s:Math.max(T.s, FOLLOW_S)});
  }
  // мелкие сдвиги не анимируем: GPS присылает точку каждую секунду
  function glide(v){
    clampV(v);
    if(!anim && Math.hypot((v.x - T.x) * T.s, (v.y - T.y) * T.s) < 10 && Math.abs(Math.log(v.s / T.s)) < .12) return;
    animateTo(v, 600);
  }

  return {
    setState({active, visited, target}){
      state = {active, visited, target};
      markers.forEach(m => {
        const ids = m.g.ids;
        m.el.classList.toggle("on", ids.includes(active));
        m.el.classList.toggle("v", ids.some(i => visited.has(i)));
        m.el.classList.toggle("tg", ids.includes(target));
        m.lbl.classList.toggle("on", ids.includes(active));
      });
      svg.querySelectorAll(".cm-hb").forEach(p => {
        const ids = p.dataset.i.split(",").map(Number);
        p.classList.toggle("v", ids.some(i => visited.has(i)));
        p.classList.toggle("on", ids.includes(active));
      });
      svg.querySelectorAll(".cm-leg").forEach(p => {
        const i = +p.dataset.to;
        p.classList.toggle("done", visited.has(i) && visited.has(i - 1));
        p.classList.toggle("next", i === target);
      });
      layout();
      if(follow && lastPos && nearMap(lastPos) && target !== prevTarget) centerOn(lastPos);
      prevTarget = target;
    },
    focus(i){ const xy = stopXY[i]; if(xy) animateTo({x:xy[0], y:xy[1], s:Math.max(T.s, 1.1)}, 500); },
    updateMe(pos){
      lastPos = pos || null;
      placeMe();
      if(pos && follow && nearMap(pos) && !ptrs.size) centerOn(pos);
    },
    follow(on){ follow = on; if(on && lastPos && nearMap(lastPos)) centerOn(lastPos); },
    near(pos){ return nearMap(pos); },
    hasMe(){ return !!lastPos; },
    destroy(){ stopAnim(); ro.disconnect(); clearTimeout(commitTimer); el.classList.remove("cm", "z-hi"); }
  };
}
