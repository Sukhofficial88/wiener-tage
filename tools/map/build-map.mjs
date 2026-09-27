// Turns raw OpenStreetMap data (tools/map/fetch-osm.mjs) into compact map files data/map/<hero>.json:
// SVG paths in metres around the centre of each area, grouped by layer, plus label candidates and walking routes.
// Usage: node tools/map/build-map.mjs [raw-dir]
// Map data © OpenStreetMap contributors, ODbL.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { HEROES, CTX } from "../../js/data.js";

const RAW = process.argv[2] || new URL("./raw/", import.meta.url).pathname;
const OUT = new URL("../../data/map/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const RING = /^(Stubenring|Parkring|Schubertring|Kärntner Ring|Opernring|Burgring|Dr\.-Karl-Renner-Ring|Universitätsring|Schottenring)$/;

/* ---------- classification ---------- */
function areaClass(t){
  if(t.natural === "water" || t.water || t.waterway === "riverbank" || /^(reservoir|basin)$/.test(t.landuse || "")) return "water";
  if(t.landuse === "forest" || t.natural === "wood") return "wood";
  if(/^(vineyard|orchard)$/.test(t.landuse || "")) return "vine";
  if(t.landuse === "cemetery") return "cem";
  if(/^(park|garden|playground|nature_reserve|pitch)$/.test(t.leisure || "") ||
     /^(grass|meadow|village_green|recreation_ground|allotments|farmland)$/.test(t.landuse || "") ||
     /^(grassland|heath|scrub)$/.test(t.natural || "")) return "park";
  if(t["area:highway"] || (t.highway && t.area === "yes") || t.place === "square") return "sq";
  return null;
}
function lineClass(t){
  if(t.tunnel && t.tunnel !== "no") return null;
  if(t.area === "yes") return null;
  const h = t.highway;
  if(h){
    if(t.covered === "yes" || t.indoor === "yes") return null;
    if(/^(motorway|trunk|primary|secondary)(_link)?$/.test(h) && RING.test(t.name || "")) return "ring";
    if(/^(motorway|trunk|primary)(_link)?$/.test(h)) return "r1";
    if(/^secondary(_link)?$/.test(h)) return "r2";
    if(/^tertiary(_link)?$/.test(h)) return "r3";
    if(/^(residential|unclassified|living_street|road)$/.test(h)) return "r4";
    if(h === "pedestrian") return "r5";
    if(/^(footway|path|steps|bridleway|track)$/.test(h)){
      if(/^(sidewalk|crossing|traffic_island|access_aisle)$/.test(t.footway || t.path || "")) return null;
      return "r6";
    }
    return null;
  }
  if(t.railway){
    if(t.service || !/^(rail|light_rail|subway|narrow_gauge)$/.test(t.railway)) return null;
    return "rail";
  }
  if(t.waterway){
    if(/^(river|canal)$/.test(t.waterway)) return "wl1";
    if(/^(stream|brook|ditch|drain)$/.test(t.waterway)) return "wl2";
  }
  return null;
}
const isLandmark = t => /^(place_of_worship|theatre|university|concert_hall|townhall|arts_centre)$/.test(t.amenity || "") ||
  /^(church|cathedral|chapel|basilica|palace|theatre|university|museum|parliament|opera_house)$/.test(t.building || "") ||
  /^(museum|attraction)$/.test(t.tourism || "") || /^(castle|palace|church|monument)$/.test(t.historic || "");

/* ---------- geometry ---------- */
function projector(bbox){
  const [s, w, n, e] = bbox, lat0 = (s + n) / 2, lng0 = (w + e) / 2;
  const MG = 111320 * Math.cos(lat0 * Math.PI / 180), ML = 110574;
  const P = (lat, lon) => [(lon - lng0) * MG, (lat0 - lat) * ML];
  return { P, lat0, lng0, MG, ML, bounds: [(w - lng0) * MG, (lat0 - n) * ML, (e - lng0) * MG, (lat0 - s) * ML] };
}
// Overpass "out geom(bbox)" leaves nodes outside the box as null: split there.
function pieces(geom, P){
  const out = []; let cur = [];
  for(const g of geom || []){
    if(!g){ if(cur.length > 1) out.push(cur); cur = []; continue; }
    cur.push(P(g.lat, g.lon));
  }
  if(cur.length > 1) out.push(cur);
  return out;
}
const same = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
const closed = p => p.length > 3 && same(p[0], p[p.length - 1]);
function joinChains(segs){
  const chains = segs.map(s => s.slice());
  let merged = true;
  while(merged){
    merged = false;
    outer: for(let i = 0; i < chains.length; i++){
      if(closed(chains[i])) continue;
      for(let j = i + 1; j < chains.length; j++){
        if(closed(chains[j])) continue;
        const a = chains[i], b = chains[j];
        let r = null;
        if(same(a[a.length - 1], b[0])) r = a.concat(b.slice(1));
        else if(same(a[a.length - 1], b[b.length - 1])) r = a.concat(b.slice(0, -1).reverse());
        else if(same(a[0], b[b.length - 1])) r = b.concat(a.slice(1));
        else if(same(a[0], b[0])) r = b.slice().reverse().concat(a.slice(1));
        if(r){ chains[i] = r; chains.splice(j, 1); merged = true; break outer; }
      }
    }
  }
  return chains;
}
function simplify(pts, tol){
  if(pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while(stack.length){
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    for(let i = a + 1; i < b; i++){
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if(d > md){ md = d; mi = i; }
    }
    if(md > tol){ keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const len = p => p.reduce((s, q, i) => i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0, 0);
function ringArea(p){ let a = 0; for(let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); }
function inside(pt, ring){
  let c = false;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// A point well inside a polygon for its label: best of a coarse grid by distance to the edge.
function labelPoint(ring){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const [x, y] of ring){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const edge = pt => { let m = Infinity; for(let i = 1; i < ring.length; i++){ const [ax, ay] = ring[i - 1], [bx, by] = ring[i]; const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9; const t = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / L2)); m = Math.min(m, Math.hypot(pt[0] - ax - t * dx, pt[1] - ay - t * dy)); } return m; };
  let best = null, bd = 0;
  for(let i = 1; i < 12; i++) for(let j = 1; j < 12; j++){
    const pt = [x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * j / 12];
    if(!inside(pt, ring)) continue;
    const d = edge(pt); if(d > bd){ bd = d; best = pt; }
  }
  return best && { pt: best, room: bd };
}

/* ---------- path encoding: absolute start, then relative steps, 0.1 m ---------- */
const r1 = v => Math.round(v * 10) / 10;
function num(v){ const s = String(r1(v)); return s === "-0" ? "0" : s; }
function enc(pts, close){
  let s = "M" + num(pts[0][0]) + " " + num(pts[0][1]) + "l";
  let px = r1(pts[0][0]), py = r1(pts[0][1]), first = true;
  for(let i = 1; i < pts.length; i++){
    const x = r1(pts[i][0]), y = r1(pts[i][1]), dx = r1(x - px), dy = r1(y - py);
    if(!dx && !dy) continue;
    const a = num(dx), b = num(dy);
    s += (first || a[0] === "-" ? "" : " ") + a + (b[0] === "-" ? "" : " ") + b;
    px = x; py = y; first = false;
  }
  if(first) return "";
  return s + (close ? "z" : "");
}

/* ---------- build ---------- */
for(const h of HEROES){
  const osm = JSON.parse(readFileSync(`${RAW}/${h.id}-osm.json`, "utf8"));
  const routes = JSON.parse(readFileSync(`${RAW}/${h.id}-routes.json`, "utf8"));
  const { P, lat0, lng0, MG, ML, bounds } = projector(routes.bbox);
  const small = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) < 9e6; // < 9 km²: footpaths and all buildings
  const L = {}; const add = (k, d) => { if(d) (L[k] = L[k] || []).push(d); };
  const named = []; const pointLabels = []; const stations = new Map();
  const buildings = [];
  const lmPts = CTX.landmarks.map(l => ({ k: l.k, xy: P(l.lat, l.lng) }));
  const stopPts = h.stops.map(s => P(s.lat, s.lng));

  const polys = []; // {cls, rings, tags}
  for(const el of osm.elements){
    const t = el.tags || {};
    if(el.type === "node"){
      if(!t.name) continue;
      const sub = t.station === "subway" || t.subway === "yes";
      if(t.railway === "station" || t.railway === "halt" || t.station === "subway"){
        const key = t.name.replace(/^Wien /, "");
        if(!stations.has(key) || sub) stations.set(key, { t: key, k: sub ? "u" : "s", xy: P(el.lat, el.lon) });
      }
      continue;
    }
    const isB = (t.building && t.building !== "no") || t["building:part"];
    if(el.type === "way"){
      const segs = pieces(el.geometry, P);
      const cl = segs.length === 1 && closed(segs[0]);
      if(isB){ if(cl) buildings.push({ rings: segs, tags: t }); continue; }
      const ac = areaClass(t);
      if(ac && (cl || segs.length > 1 || ac !== "sq")){ polys.push({ cls: ac, rings: segs, tags: t }); if(ac !== "sq") continue; }
      const lc = lineClass(t);
      if(lc && !(ac === "sq" && cl)){
        for(const sg of segs) add(lc, enc(simplify(sg, lc === "rail" || lc.startsWith("wl") ? 1.5 : 0.8), false));
        if(t.name && lc !== "rail" && lc !== "r6") named.push({ name: t.name, cls: lc, segs });
      }
    } else if(el.type === "relation"){
      const rings = joinChains((el.members || []).filter(m => m.type === "way").flatMap(m => pieces(m.geometry, P)));
      if(isB){ buildings.push({ rings, tags: t }); continue; }
      const ac = areaClass(t);
      if(ac) polys.push({ cls: ac, rings, tags: t });
    }
  }

  // areas
  for(const p of polys){
    const tol = p.cls === "sq" ? 0.6 : 1.5;
    const d = p.rings.map(r => enc(simplify(r, tol), true)).join("");
    add(p.cls, d);
    const name = p.tags.name;
    const big = p.rings.reduce((m, r) => ringArea(r) > ringArea(m) ? r : m, p.rings[0] || []);
    const area = big.length > 3 ? ringArea(big) : 0;
    if(name && ((p.cls === "park" && area > 2500) || (p.cls === "sq" && area > 900) || (p.cls === "water" && area > 20000 && !/kanal/i.test(name)))){
      const lp = labelPoint(big);
      if(lp && lp.room > 12) pointLabels.push({ t: name, k: p.cls, x: r1(lp.pt[0]), y: r1(lp.pt[1]), a: Math.round(area) });
    }
  }
  // buildings: landmarks, houses of the stops, the rest
  const hb = [];
  for(const b of buildings){
    const outer = b.rings.filter(r => r.length > 3);
    if(!outer.length) continue;
    const area = Math.max(...outer.map(ringArea));
    if(!small && area < 120) continue;
    const d = outer.map(r => enc(simplify(r, 0.5), true)).join("");
    const hasLm = lmPts.some(l => outer.some(r => inside(l.xy, r)));
    const stopIdx = stopPts.map((xy, i) => outer.some(r => inside(xy, r)) ? i : -1).filter(i => i >= 0);
    if(stopIdx.length) hb.push({ i: stopIdx, d });
    add(hasLm || (isLandmark(b.tags) && area > 400) ? "lmk" : "bldg", d);
  }

  // street and water names along their lines
  const byName = new Map();
  for(const n of named){ const e = byName.get(n.name) || { cls: n.cls, segs: [] }; e.segs.push(...n.segs); if(rank(n.cls) < rank(e.cls)) e.cls = n.cls; byName.set(n.name, e); }
  function rank(c){ return { ring: 0, wl1: 0, r1: 1, r5: 1, r2: 2, wl2: 2, r3: 3, r4: 4 }[c] ?? 5; }
  const lab = [];
  for(const [name, e] of byName){
    const chains = joinChains(e.segs).map(c => simplify(c, 3)).map(c => ({ c, n: len(c) })).filter(o => o.n > 45).sort((a, b) => b.n - a.n).slice(0, 3);
    for(const { c, n } of chains){
      const pts = c[c.length - 1][0] < c[0][0] ? c.slice().reverse() : c;
      lab.push({ t: name, c: e.cls, p: enc(pts, false), n: Math.round(n) });
    }
  }
  lab.sort((a, b) => rank(a.c) - rank(b.c) || b.n - a.n);

  // walking legs: stop → street network → next stop
  const rt = routes.legs.map((leg, i) => {
    if(!leg) return null;
    const a = stopPts[i], z = stopPts[i + 1];
    const pts = [a, ...leg.coords.map(([lon, lat]) => P(lat, lon)), z];
    return enc(simplify(pts, 0.8), false);
  });

  const out = {
    v: 1, src: "© OpenStreetMap contributors (ODbL)", o: [lat0, lng0], m: [r1(MG), ML], b: bounds.map(r1),
    l: Object.fromEntries(["wood", "park", "vine", "cem", "water", "wl2", "wl1", "sq", "bldg", "lmk", "rail", "r6", "r5", "r4", "r3", "r2", "r1", "ring"].filter(k => L[k]).map(k => [k, L[k].join("")])),
    hb, lab, pl: pointLabels.sort((a, b) => b.a - a.a),
    st: [...stations.values()].map(s => ({ t: s.t, k: s.k, x: r1(s.xy[0]), y: r1(s.xy[1]) })),
    rt
  };
  const json = JSON.stringify(out);
  writeFileSync(new URL(`${h.id}.json`, OUT), json);
  console.log(h.id, (json.length / 1024).toFixed(0) + " KB", Object.entries(out.l).map(([k, v]) => k + ":" + (v.length / 1024).toFixed(0)).join(" "), "| labels", lab.length, "points", pointLabels.length, "stations", out.st.length, "houses", hb.length);
}
