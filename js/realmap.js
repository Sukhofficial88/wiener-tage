// Настоящая карта: MapLibre GL + OpenFreeMap (данные OpenStreetMap), пешеходный маршрут по улицам (OSRM, FOSSGIS).
// Если карта недоступна (нет WebGL, нет сети и кэша), приложение показывает схему из map.js.

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const OSRM_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";

let libPromise = null;
function loadLib(){
  if(!libPromise) libPromise = (async()=>{
    if(!document.querySelector("link[data-maplibre]")){
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = "css/vendor/maplibre-gl.css"; l.dataset.maplibre = "1";
      document.head.appendChild(l);
    }
    return await import("./vendor/maplibre-gl.mjs");
  })();
  return libPromise;
}

export function realMapAvailable(){
  if(window.__WT_NO_REALMAP) return false;
  try{ const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); }catch(e){ return false; }
}

function timeout(p, ms, what){
  return Promise.race([p, new Promise((_, rej)=>setTimeout(()=>rej(new Error(what+" timeout")), ms))]);
}

/* ---------- цвета карты из токенов текущей схемы ---------- */
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function hex(c){ c = c.replace("#",""); if(c.length === 3) c = c.split("").map(x=>x+x).join(""); return [0,2,4].map(i=>parseInt(c.slice(i,i+2),16)); }
function mix(a, b, k){ const A = hex(a), B = hex(b); return "#"+A.map((v,i)=>Math.round(v+(B[i]-v)*k).toString(16).padStart(2,"0")).join(""); }
function lum(c){ const [r,g,b] = hex(c).map(v=>v/255); return 0.2126*r+0.7152*g+0.0722*b; }

function recolor(style){
  const bg = cssVar("--map-bg"), ink = cssVar("--ink");
  const dark = lum(bg) < 0.4;
  const C = {
    bg, land: mix(bg, ink, dark ? .04 : .03), water: cssVar("--water"), park: cssVar("--park"),
    building: mix(bg, ink, dark ? .13 : .09), road: dark ? mix(bg, ink, .2) : null, roadMajor: dark ? mix(bg, ink, .3) : null,
    casing: mix(bg, ink, dark ? .1 : .2), rail: mix(bg, ink, .3), label: dark ? cssVar("--ink-2") : null,
    halo: bg, waterLabel: dark ? mix(cssVar("--water"), ink, .5) : null
  };
  for(const l of style.layers || []){
    const sl = l["source-layer"] || "", id = l.id.toLowerCase(), p = l.paint = l.paint || {};
    if(l.type === "background"){ p["background-color"] = C.bg; continue; }
    if(l.type === "fill"){
      if(sl === "water") p["fill-color"] = C.water;
      else if(sl === "park" || /park|wood|grass|forest|cemetery|garden|pitch|meadow|scrub/.test(id)) p["fill-color"] = C.park;
      else if(sl === "building") p["fill-color"] = C.building;
      else if(sl === "landuse" || sl === "landcover" || sl === "aeroway") p["fill-color"] = C.land;
      if(p["fill-pattern"] && dark) delete p["fill-pattern"];
    }
    if(l.type === "fill-extrusion" && sl === "building") p["fill-extrusion-color"] = C.building;
    if(l.type === "line"){
      if(sl === "waterway" || sl === "water") p["line-color"] = C.water;
      else if(/rail|transit/.test(id)) p["line-color"] = C.rail;
      else if(sl === "transportation"){
        if(/casing/.test(id)) p["line-color"] = C.casing;
        else if(dark) p["line-color"] = /motorway|trunk|primary|secondary/.test(id) ? C.roadMajor : C.road;
      }
    }
    if(l.type === "symbol"){
      if(p["text-color"] !== undefined || l.layout && l.layout["text-field"]){
        if(C.label) p["text-color"] = sl === "water_name" || sl === "waterway" ? C.waterLabel : C.label;
        p["text-halo-color"] = C.halo;
      }
    }
  }
  return style;
}

/* ---------- геометрия ---------- */
function circle(lng, lat, r, n=40){
  const out = [], k = Math.cos(lat*Math.PI/180);
  for(let i=0;i<=n;i++){ const a = i/n*2*Math.PI; out.push([lng + r*Math.cos(a)/(111320*k), lat + r*Math.sin(a)/110574]); }
  return {type:"Feature", geometry:{type:"Polygon", coordinates:[out]}, properties:{}};
}
const fc = features => ({type:"FeatureCollection", features});
function straight(stops){
  return stops.slice(1).map((s,i)=>({type:"Feature", properties:{transit:!!s.transit},
    geometry:{type:"LineString", coordinates:[[stops[i].lng, stops[i].lat],[s.lng, s.lat]]}}));
}

// Пешеходные отрезки по улицам (OSRM). Отрезки на транспорте — прямым пунктиром. Результат кэшируется.
export async function walkingRoute(stops){
  const segs = []; let chain = [stops[0]];
  for(let i=1;i<stops.length;i++){
    if(stops[i].transit){
      if(chain.length > 1) segs.push({pts:chain});
      segs.push({pts:[stops[i-1], stops[i]], transit:true});
      chain = [stops[i]];
    } else chain.push(stops[i]);
  }
  if(chain.length > 1) segs.push({pts:chain});
  const features = [];
  for(const seg of segs){
    const coords = seg.pts.map(p=>`${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
    if(seg.transit){ features.push({type:"Feature", properties:{transit:true}, geometry:{type:"LineString", coordinates:seg.pts.map(p=>[p.lng,p.lat])}}); continue; }
    const key = "wt-osrm-v1:"+coords;
    let line = null;
    try{ line = JSON.parse(localStorage.getItem(key) || "null"); }catch(e){}
    if(!line){
      try{
        const r = await timeout(fetch(OSRM_URL+coords+"?overview=full&geometries=geojson&steps=false"), 9000, "route");
        const d = await r.json();
        if(d && d.code === "Ok" && d.routes && d.routes[0]){ line = d.routes[0].geometry.coordinates; try{ localStorage.setItem(key, JSON.stringify(line)); }catch(e){} }
      }catch(e){}
    }
    features.push({type:"Feature", properties:{transit:false, routed:!!line}, geometry:{type:"LineString", coordinates: line || seg.pts.map(p=>[p.lng,p.lat])}});
  }
  return fc(features);
}

/* ---------- карта ---------- */
export async function mountRealMap(el, hero, stops, opts){
  if(!realMapAvailable()) throw new Error("no webgl");
  const ml = await timeout(loadLib(), 15000, "lib");
  const res = await timeout(fetch(STYLE_URL), 9000, "style");
  if(!res.ok) throw new Error("style "+res.status);
  const style = recolor(await res.json());
  const hc = getComputedStyle(el).getPropertyValue("--hc").trim() || cssVar("--primary");
  const lngs = stops.map(s=>s.lng), lats = stops.map(s=>s.lat);
  const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];

  const map = new ml.Map({container:el, style, bounds, fitBoundsOptions:{padding:{top:40,bottom:30,left:30,right:30}, maxZoom:16},
    attributionControl:{compact:true}, dragRotate:false, pitchWithRotate:false, maxZoom:19});
  map.touchZoomRotate.disableRotation();
  map.addControl(new ml.NavigationControl({showCompass:false}), "top-right");
  await timeout(new Promise(r=>map.once("load", r)), 15000, "map");

  // маршрут
  map.addSource("wt-route", {type:"geojson", data:fc(straight(stops))});
  map.addLayer({id:"wt-route-halo", type:"line", source:"wt-route", layout:{"line-join":"round","line-cap":"round"}, paint:{"line-color":cssVar("--map-bg"), "line-width":8, "line-opacity":.9}});
  map.addLayer({id:"wt-route-walk", type:"line", source:"wt-route", filter:["!", ["get","transit"]], layout:{"line-join":"round","line-cap":"round"}, paint:{"line-color":hc, "line-width":4.5}});
  map.addLayer({id:"wt-route-transit", type:"line", source:"wt-route", filter:["get","transit"], layout:{"line-join":"round","line-cap":"round"}, paint:{"line-color":hc, "line-width":3.5, "line-dasharray":[0.3,2.2]}});
  // зоны срабатывания
  map.addSource("wt-zones", {type:"geojson", data:fc(stops.map(s=>circle(s.lng, s.lat, s.radius||45)))});
  map.addLayer({id:"wt-zones-fill", type:"fill", source:"wt-zones", paint:{"fill-color":hc, "fill-opacity":.07}});
  map.addLayer({id:"wt-zones-line", type:"line", source:"wt-zones", paint:{"line-color":hc, "line-width":1, "line-dasharray":[2,2], "line-opacity":.6}});
  // точность геопозиции
  map.addSource("wt-acc", {type:"geojson", data:fc([])});
  map.addLayer({id:"wt-acc", type:"fill", source:"wt-acc", paint:{"fill-color":cssVar("--me"), "fill-opacity":.14}});

  // точки: одинаковые места объединяем (1·5)
  const groups = [];
  stops.forEach((s,i)=>{
    const g = groups.find(g=>Math.abs(g.s.lat-s.lat) < 0.0002 && Math.abs(g.s.lng-s.lng) < 0.0003);
    if(g) g.ids.push(i); else groups.push({s, ids:[i]});
  });
  const markers = groups.map(g=>{
    const b = document.createElement("button");
    b.type = "button"; b.className = "rm-mk"; b.dataset.i = g.ids.join(",");
    b.setAttribute("aria-label", g.ids.map(i=>(i+1)+". "+stops[i].title).join("; "));
    b.innerHTML = `<span class="rm-num">${g.ids.map(i=>i+1).join("·")}</span><span class="rm-lbl">${stops[g.ids[0]].short}</span>`;
    b.addEventListener("click", e=>{ e.stopPropagation(); opts.onPick && opts.onPick(g.ids[0]); });
    new ml.Marker({element:b, anchor:"left", offset:[-13,0]}).setLngLat([g.s.lng, g.s.lat]).addTo(map);
    return b;
  });

  // «я»
  const meEl = document.createElement("div"); meEl.className = "rm-me";
  const me = new ml.Marker({element:meEl}).setLngLat([stops[0].lng, stops[0].lat]);
  let meShown = false, follow = false, lastPos = null;
  const zoomLabels = ()=>el.classList.toggle("z-hi", map.getZoom() >= 16.3);
  map.on("zoom", zoomLabels); zoomLabels();
  map.on("dragstart", ()=>{ follow = false; });

  // улицы для маршрута догружаем после показа карты
  walkingRoute(stops).then(data=>{ try{ map.getSource("wt-route").setData(data); }catch(e){} });

  return {
    map,
    setState({active, visited, target}){
      markers.forEach(b=>{
        const ids = b.dataset.i.split(",").map(Number);
        b.classList.toggle("on", ids.includes(active));
        b.classList.toggle("v", ids.some(i=>visited.has(i)));
        b.classList.toggle("tg", ids.includes(target));
      });
    },
    focus(i){ const s = stops[i]; if(s) map.easeTo({center:[s.lng, s.lat], duration:600}); },
    updateMe(pos){
      if(!pos){ if(meShown){ me.remove(); meShown = false; } map.getSource("wt-acc").setData(fc([])); return; }
      lastPos = pos;
      me.setLngLat([pos.lng, pos.lat]); if(!meShown){ me.addTo(map); meShown = true; }
      map.getSource("wt-acc").setData(fc(pos.acc ? [circle(pos.lng, pos.lat, Math.min(pos.acc, 300))] : []));
      if(follow) map.easeTo({center:[pos.lng, pos.lat], zoom:Math.max(map.getZoom(), 16), duration:800});
    },
    follow(on){ follow = on; if(on && lastPos) map.easeTo({center:[lastPos.lng, lastPos.lat], zoom:Math.max(map.getZoom(), 16), duration:600}); },
    hasMe(){ return !!lastPos; },
    // Скачиваем плитки района маршрута (масштабы 12–14; ближе карта дорисовывает сама) для работы без сети
    async prefetch(){
      try{
        const st = map.getStyle(); const key = Object.keys(st.sources).find(k=>st.sources[k].type === "vector");
        const srcObj = key && map.getSource(key);
        const tpl = srcObj && srcObj.tiles && srcObj.tiles[0]; if(!tpl) return;
        const pad = 0.01, w = Math.min(...lngs)-pad, e = Math.max(...lngs)+pad, s = Math.min(...lats)-pad, n = Math.max(...lats)+pad;
        const tx = (lng,z)=>Math.floor((lng+180)/360*2**z);
        const ty = (lat,z)=>{ const r = lat*Math.PI/180; return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*2**z); };
        const urls = [];
        for(let z=12; z<=14; z++) for(let x=tx(w,z); x<=tx(e,z); x++) for(let y=ty(n,z); y<=ty(s,z); y++) urls.push(tpl.replace("{z}",z).replace("{x}",x).replace("{y}",y));
        for(const u of urls.slice(0, 120)){ try{ await fetch(u, {mode:"cors"}); }catch(e){ return; } }
      }catch(e){}
    },
    destroy(){ try{ map.remove(); }catch(e){} }
  };
}
