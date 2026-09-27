import { HEROES as BASE_HEROES, UPCOMING as BASE_UPCOMING, LINKS as BASE_LINKS, RECORDINGS } from "./data.js";
import { LANGS, detectLang, setLang, lang, langInfo, t, tp, fmtNum } from "./i18n.js";
import ru from "./content/ru.js";
import de from "./content/de.js";
import en from "./content/en.js";
import fr from "./content/fr.js";
import it from "./content/it.js";
import es from "./content/es.js";
import { Geo, dist } from "./geo.js";
import { Voice, Hear } from "./audio.js";
import { mapSVG, updateMe as updateSchemeMe } from "./map.js";
import { loadCityMap, mountCityMap } from "./citymap.js";

const APP_VERSION = "0.7.1";
const CONTENT = {ru, de, en, fr, it, es};

/* ============================ helpers ============================ */
const $ = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>[...el.querySelectorAll(s)];
const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

const km = m => fmtNum(m/1000, 1);
const fmtDist = m => m >= 1000 ? t("u_km", {n:km(m)}) : t("u_m", {n:Math.max(10, Math.round(m/10)*10)});
function fmtMin(min){
  min = Math.max(10, Math.round(min/10)*10);
  const h = Math.floor(min/60), m = min%60;
  return h ? (m ? t("u_hm", {h, m}) : t("u_h", {n:h})) : t("u_min", {n:m});
}
const countWord = (key, n)=> `${fmtNum(n)} ${tp(key, n)}`;

/* ============================ storage ============================ */
const K = {visited:"wt-visited-v1", settings:"wt-settings-v1", overrides:"wt-overrides-v1", install:"wt-install-hidden", lang:"wt-lang"};
function load(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

let visited = load(K.visited, {}) || {};
let settings = Object.assign({autoVoice:true, vibrate:true, calibrate:false, voices:{}, palette:"cafe"}, load(K.settings, {}) || {});
const PALETTES = [
  {id:"cafe",   sw:["#F3EDE1","#1F4538","#B08D57","#8C2F39"]},
  {id:"gold",   sw:["#121110","#D4AF5A","#F1EADB","#E08A8F"]},
  {id:"pastel", sw:["#ECF0EA","#557C67","#A9575E","#4F6F94"]}
];
function applyPalette(){
  const el = document.documentElement;
  if(settings.palette && settings.palette !== "cafe") el.dataset.palette = settings.palette; else delete el.dataset.palette;
  const bg = getComputedStyle(el).getPropertyValue("--bg").trim();
  $$('meta[name="theme-color"]').forEach(m=>m.setAttribute("content", bg));
}
let overrides = load(K.overrides, {}) || {};

const isVisited = (id, i)=> (visited[id]||[]).includes(i);
function setVisited(id, i, v){
  const a = new Set(visited[id]||[]); v ? a.add(i) : a.delete(i);
  visited[id] = [...a].sort((x,y)=>x-y); save(K.visited, visited);
}

/* ============================ локализованные данные ============================ */
let LOC = null;
function localize(){
  const c = CONTENT[lang()] || CONTENT.en;
  const heroes = BASE_HEROES.map(h=>{
    const tx = c.heroes[h.id];
    return {...h, ...tx, stops: h.stops.map((s,i)=>{ const o = {...s, ...tx.stops[i]}; if(!s.transit) delete o.go; return o; })};
  });
  LOC = {
    heroes,
    upcoming: BASE_UPCOMING.map(u=>({...u, ...c.upcoming[u.id]})),
    links: BASE_LINKS.map((l,i)=>({...l, ...c.links[i]})),
    how: c.how
  };
}
const heroById = id => LOC.heroes.find(h=>h.id===id);
const anyById = id => heroById(id) || LOC.upcoming.find(u=>u.id===id);
const isActiveHero = id => !!heroById(id);
const heroVars = h => ({short:h.short, ins:h.ins || h.short, gen:h.gen || h.short, name:h.name});
// Записи есть для героя на текущем языке? key: номер точки (с нуля), "intro" или "epilogue"
const recorded = h => !!h && (RECORDINGS[lang()] || []).includes(h.id);
function audioFor(h, key){
  if(recorded(h)) return `audio/${lang()}/${h.id}-${typeof key === "number" ? key+1 : key}.mp3`;
  const s = typeof key === "number" ? h.stops[key] : null;
  return !s || !s.audio ? null : (typeof s.audio === "string" ? s.audio : (s.audio[lang()] || null));
}
// Заранее скачиваем записи маршрута, чтобы прогулка шла без интернета
function prefetchAudio(h){
  if(!recorded(h) || !("fetch" in window)) return;
  const keys = ["intro", ...h.stops.map((_,i)=>i), "epilogue"];
  (async()=>{ for(const k of keys){ try{ await fetch(audioFor(h, k)); }catch(e){ return; } } })();
}

function stopsOf(h){
  const o = overrides[h.id] || {};
  return h.stops.map((s,i)=> o[i] ? {...s, lat:o[i].lat, lng:o[i].lng, calibrated:true} : s);
}
function legs(stops){
  return stops.map((s,i)=>{
    if(!i) return null;
    const d = dist(stops[i-1], s);
    return {d, walk:d*1.3, transit:!!s.transit, same:d<25};
  });
}
function dayStats(h){
  const st = stopsOf(h); const L = legs(st).filter(Boolean);
  const walkM = L.filter(l=>!l.transit).reduce((a,l)=>a+l.walk, 0);
  const transit = L.filter(l=>l.transit).length;
  const places = new Set(st.map(s=>s.addr)).size;
  return {walkM, transit, places, minutes: walkM/75 + st.length*12 + transit*35};
}
const gmapsLang = ()=>"&hl="+lang();
const mapsSearch = addr => "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(addr)+gmapsLang();
const mapsNav = s => "https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(s.addr)+"&travelmode="+(s.transit?"transit":"walking")+gmapsLang();
function mapsRoute(stops){
  const a = []; stops.forEach(s=>{ if(a[a.length-1] !== s.addr) a.push(s.addr); });
  const o = a[0], d = a[a.length-1], w = a.slice(1,-1);
  return "https://www.google.com/maps/dir/?api=1&travelmode=walking&origin="+encodeURIComponent(o)+"&destination="+encodeURIComponent(d)+(w.length?"&waypoints="+encodeURIComponent(w.join("|")):"")+gmapsLang();
}

const ICON = {
  play:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
  stop:'<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" fill="currentColor"/></svg>',
  check:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  out:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H3v10h10v-3M9 2h5v5M14 2L7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  walk:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="9" cy="2.6" r="1.6" fill="currentColor"/><path d="M8 5.5L6 9l2 1.5-1 4.5M8 5.5l2.5 2.5 2 .5M6 9L4.5 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  tram:'<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="9" height="9.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 8h9M5.5 15l1-2.5M10.5 15l-1-2.5M6 1h4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  pin:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="6.5" r="1.8" fill="currentColor"/></svg>',
  demo:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 5.2v5.6L11 8z" fill="currentColor"/></svg>'
};

function monogram(h, size){
  const s = size || 56;
  const oct = (m)=>{ const a = m, b = 60-m, c = m+14, d = 46-m; return `M${c} ${a}H${d}L${b} ${c}V${d}L${d} ${b}H${c}L${a} ${d}V${c}Z`; };
  return `<svg width="${s}" height="${s}" viewBox="0 0 60 60" role="img" aria-label="${h.name}">
    <path d="${oct(1)}" fill="color-mix(in srgb, var(--hc) 8%, var(--surface))" stroke="var(--hc)" stroke-width="1.5"/>
    <path d="${oct(5)}" fill="none" stroke="var(--deco)" stroke-width=".8"/>
    <path d="M30 4.5l2 2.5-2 2.5-2-2.5zM30 50.5l2 2.5-2 2.5-2-2.5z" fill="var(--deco)"/>
    <text x="30" y="31" text-anchor="middle" dominant-baseline="central" font-family="Forum, Georgia, serif" font-size="${h.mono.length>2?16:21}" fill="var(--hc)" letter-spacing="1">${h.mono}</text>
  </svg>`;
}
const DECO = `<p class="deco" aria-hidden="true"><svg viewBox="0 0 46 12"><path d="M23 1l5 5-5 5-5-5z" fill="currentColor"/><path d="M11 6l3-3 3 3-3 3zM29 6l3-3 3 3-3 3z" fill="none" stroke="currentColor" stroke-width="1"/><path d="M0 6h9M37 6h9" stroke="currentColor" stroke-width="1"/></svg></p>`;

function toast(msg, actionLabel, action, ms){
  const el = $("#toast");
  el.innerHTML = `<span>${msg}</span>${actionLabel?`<button class="btn small solid" type="button">${actionLabel}</button>`:""}`;
  el.hidden = false;
  if(actionLabel) el.querySelector("button").onclick = ()=>{ el.hidden = true; action(); };
  clearTimeout(toast.tm);
  if(ms !== 0) toast.tm = setTimeout(()=>{ el.hidden = true; }, ms || 4500);
}

const isStandalone = ()=> (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const isIOS = ()=> /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ============================ state ============================ */
const S = {hero:null, active:-1, walk:null, listen:false, installEvt:null, lastPos:null};
const sameHero = (a, b)=> !!a && !!b && a.id === b.id;

/* ============================ карта ============================ */
let MAP = null, mapToken = 0;
function destroyMap(){ mapToken++; if(MAP){ MAP.destroy(); MAP = null; } }
function showMe(pos){ if(MAP) MAP.updateMe(pos); else updateSchemeMe(pos); }
function wireSchemeMarkers(){
  $$("#map .mk").forEach(g=>{
    const go = ()=>setActive(+g.dataset.i.split(",")[0], true);
    g.addEventListener("click", go);
    g.addEventListener("keydown", e=>{ if(e.key==="Enter" || e.key===" "){ e.preventDefault(); go(); } });
  });
}
// Запасной вариант, если данные карты не загрузились: схема без улиц
function showScheme(h, stops){
  const box = $("#map"); if(!box) return;
  box.className = "map-scheme"; box.innerHTML = mapSVG(h, stops);
  const mn = $("#map-note"); if(mn) mn.textContent = t("mapFallback")+" "+t("mapNote");
  wireSchemeMarkers(); refreshMarks(); markTarget();
  if(S.walk && S.walk.pos) updateSchemeMe(S.walk.pos);
}
async function mountMap(h, stops){
  destroyMap();
  const token = mapToken;
  const box = $("#map"); if(!box) return;
  try{
    const data = await loadCityMap(h.id);
    if(token !== mapToken || !document.body.contains(box)) return;
    box.className = "map-city";
    MAP = mountCityMap(box, h, stops, data, {onPick: i=>setActive(i, true), onLocate: centerMe});
    refreshMarks(); markTarget();
    if(S.walk){ if(S.walk.pos) MAP.updateMe(S.walk.pos); MAP.follow(true); }
    else if(S.lastPos) MAP.updateMe(S.lastPos);
  }catch(e){
    if(token !== mapToken) return;
    MAP = null;
    showScheme(h, stops);
  }
}
async function centerMe(){
  if(!MAP) return;
  const pos = S.walk && S.walk.pos || null;
  try{
    const p = pos || await Geo.once();
    S.lastPos = p; MAP.updateMe(p);
    if(MAP.near(p)) MAP.follow(true);
    else toast(t("mapFar"), null, null, 5000);
  }catch(e){ toast(geoErrText(e), null, null, 6000); }
}

/* ============================ язык ============================ */
function applyLanguage(code){
  setLang(code);
  localize();
  Voice.setLang(langInfo().tts);
  document.title = t("appName");
  const md = $('meta[name="description"]'); if(md) md.setAttribute("content", t("docDesc"));
  renderChrome();
}
function changeLanguage(code){
  if(code === lang()) return;
  save(K.lang, code);
  const heroId = S.hero && S.hero.id;
  S.listen = false; Voice.stop();
  if(Hear.on) Hear.stop();
  applyLanguage(code);
  if(S.walk){ S.walk.hero = heroById(S.walk.hero.id); S.walk.stops = stopsOf(S.walk.hero); }
  if(heroId) renderHero(heroById(heroId), true);
  else { const y = window.scrollY; renderHome(); window.scrollTo({top:y, behavior:"instant"}); }
  renderDock();
}

function renderChrome(){
  $("#brand-name").textContent = t("appName");
  const sub = t("brandSub"); const bs = $("#brand-sub"); bs.textContent = sub; bs.hidden = !sub;
  $("#nav-heroes").textContent = t("navHeroes");
  $("#nav-timeline").textContent = t("navTimeline");
  $("#nav-how").textContent = t("navHow");
  $("#nav").setAttribute("aria-label", t("navHeroes"));
  $("#net").textContent = t("offline");
  $("#pilot").textContent = t("pilot");
  $("#open-settings").setAttribute("aria-label", t("settingsAria"));
  $("#settings").setAttribute("aria-label", t("set_title"));
  const sel = $("#lang-select");
  sel.setAttribute("aria-label", t("langLabel"));
  sel.innerHTML = LANGS.map(l=>`<option value="${l.code}" ${l.code===lang()?"selected":""}>${l.name}</option>`).join("");
}
$("#lang-select").addEventListener("change", e=>changeLanguage(e.target.value));

/* ============================ voice glue ============================ */
function voiceNote(){
  if(recorded(S.hero)) return t("voiceRecorded");
  if(!Voice.ok) return t("voiceNoTTS");
  const base = t("voiceNote", {extra: Voice.hasLang ? "" : t("voiceNoLang")});
  return Voice.goodVoice ? base : base + " " + t("voiceHint");
}
Voice.on(()=>{ setTimeout(onVoiceIdle, 0); updateVoiceUI(); });

function listen(h, i, auto){
  const st = stopsOf(h); const s = st[i]; if(!s) return;
  S.listen = !!auto;
  setActive(i, true);
  Voice.say(h, i, s.title, s.voice, audioFor(h, i), ()=>{
    if(S.listen && i < st.length-1 && sameHero(S.hero, h)){
      setTimeout(()=>{ if(S.listen && !Voice.playing && sameHero(S.hero, h)) listen(S.hero, i+1, true); }, 900);
    } else S.listen = false;
  });
}
function stopListen(){ S.listen = false; Voice.stop(); }

function updateVoiceUI(){
  const P = Voice.playing;
  $$(".voice.speaking").forEach(v=>v.classList.remove("speaking"));
  $$("[data-speak]").forEach(b=>{ b.innerHTML = ICON.play+t("voiceBtn"); });
  if(P && sameHero(P.hero, S.hero) && typeof P.key === "number"){
    const card = $(`#stop-${P.key}`);
    if(card){ $(".voice", card)?.classList.add("speaking"); const b = $("[data-speak]", card); if(b) b.innerHTML = ICON.stop+t("stopBtn"); }
  }
  const pd = $("#play-day");
  if(pd) pd.innerHTML = (P && S.listen) ? ICON.stop+t("stopBtn") : ICON.play+t("listenDay");
  const vn = $("#voice-note"); if(vn) vn.textContent = voiceNote();
  renderDock();
}

/* ============================ walk ============================ */
function nextTarget(){ const w = S.walk; for(let i=0;i<w.stops.length;i++) if(!w.done.has(i)) return i; return -1; }
function repeatsEarlier(i){ const st = S.walk.stops; for(let j=0;j<i;j++) if(dist(st[j], st[i]) < 25) return true; return false; }

async function lockScreen(){
  try{ if("wakeLock" in navigator && S.walk){ S.walk.wake = await navigator.wakeLock.request("screen"); } }catch(e){}
}
function releaseScreen(){ try{ S.walk && S.walk.wake && S.walk.wake.release(); }catch(e){} }
document.addEventListener("visibilitychange", ()=>{ if(S.walk && document.visibilityState === "visible") lockScreen(); });

function startWalk(demo){
  const h = S.hero; if(!h) return;
  if(S.walk) endWalk(true);
  S.listen = false; Voice.broken = false;
  if(Hear.on) stopHearing();
  const stops = stopsOf(h);
  const done = new Set(demo ? [] : (visited[h.id]||[]));
  if(done.size >= stops.length) done.clear();
  S.walk = {hero:h, stops, demo, done, pending:[], pos:null, err:null, finished:false};
  S.walk.target = nextTarget();
  const tg = stops[S.walk.target];
  document.body.classList.add("walking");
  const introText = t(S.walk.target === 0 ? "introFirst" : "introNext", {...heroVars(h), title:tg.title});
  const introUrl = recorded(h) && S.walk.target === 0 ? audioFor(h, "intro") : null;
  if(settings.autoVoice) Voice.unlock(recorded(h) && !introUrl ? null : introText, h, introUrl, "audio/silence.mp3");
  else Voice.unlock(null, h, null, "audio/silence.mp3");
  prefetchAudio(h);
  lockScreen();
  if(MAP) MAP.follow(true);
  if(demo) Geo.demo(stops, onPos, ()=>!!Voice.playing || !!(S.walk && S.walk.pending.length), ()=>{});
  else Geo.start(onPos, onGeoErr);
  markTarget(); renderDock();
}

function endWalk(silent){
  if(!S.walk) return;
  Geo.stop(); releaseScreen();
  S.walk = null;
  Voice.stop();
  showMe(null);
  if(MAP) MAP.follow(false);
  document.body.classList.remove("walking");
  markTarget(); renderDock();
  if(!silent) toast(t("toastWalkEnded"));
}

function onPos(pos){
  const w = S.walk; if(!w) return;
  w.pos = pos; w.err = null; S.lastPos = pos;
  showMe(pos);
  if(w.finished || pos.acc > 120 || w.target < 0){ renderDock(); return; }
  const slack = Math.min(pos.acc||0, 25);
  const order = [w.target, ...w.stops.map((_,i)=>i).filter(i=>i !== w.target)];
  let hit = -1;
  for(const i of order){
    if(w.done.has(i)) continue;
    if(i !== w.target && repeatsEarlier(i)) continue;
    const s = w.stops[i];
    if(dist(pos, s) <= (s.radius||45) + slack){ hit = i; break; }
  }
  if(hit >= 0) arrive(hit); else renderDock();
}

function onGeoErr(e){ if(!S.walk) return; S.walk.err = e; renderDock(); }
function geoErrText(e){
  if(!e) return "";
  if(e.code === 1) return t("geoErr1");
  if(e.code === 2) return t("geoErr2");
  if(e.code === 3) return t("geoErr3");
  return t("geoErr0");
}

function arrive(i){
  const w = S.walk; if(!w || w.done.has(i)) return;
  w.done.add(i);
  setVisited(w.hero.id, i, true); syncVisitUI(i);
  w.target = nextTarget();
  if(settings.vibrate && navigator.vibrate){ try{ navigator.vibrate([90,60,90]); }catch(e){} }
  setActive(i, true);
  if(settings.autoVoice){
    if(Voice.playing) w.pending.push(i); else playInWalk(i);
  } else if(w.target < 0) finishWalk();
  markTarget(); renderDock();
}

function playInWalk(i){
  const w = S.walk; const s = w.stops[i];
  Voice.say(w.hero, i, s.title, s.voice, audioFor(w.hero, i), null);
}

function onVoiceIdle(){
  const w = S.walk; if(!w || Voice.playing) return;
  if(w.pending.length){ playInWalk(w.pending.shift()); return; }
  if(w.target < 0 && !w.finished) finishWalk();
}

function finishWalk(){
  const w = S.walk; if(!w || w.finished) return;
  w.finished = true;
  if(w.demo) Geo.stopDemo();
  renderDock();
  if(settings.autoVoice) Voice.say(w.hero, "epilogue", t("afterDay"), w.hero.epilogue, audioFor(w.hero, "epilogue"), null);
}

function markTarget(){
  const tg = S.walk && !S.walk.finished ? S.walk.target : -1;
  $$("#map .mk").forEach(g=>g.classList.toggle("tg", g.dataset.i.split(",").map(Number).includes(tg)));
  if(MAP && S.hero) MAP.setState({active:S.active, visited:new Set(visited[S.hero.id]||[]), target:tg});
}

/* ============================ dock (нижняя панель) ============================ */
function dockBtn(act, label, icon, solid){ return `<button type="button" class="btn small${solid?" solid":""}" data-act="${act}">${icon?ICON[icon]:""}${label}</button>`; }

function renderDock(){
  const d = $("#dock"); if(!d) return;
  const w = S.walk; const P = Voice.playing;
  if(w){
    const st = w.stops;
    let chip, main, sub = "", acts = [];
    if(w.demo) chip = `<span class="gps demo">${t("gpsDemo")}</span>`;
    else if(w.err && w.err.code !== 3 && !w.pos) chip = `<span class="gps bad">${t("gpsNA")}</span>`;
    else if(!w.pos) chip = `<span class="gps wait">${t("gpsWait")}</span>`;
    else chip = `<span class="gps ${w.pos.acc<=30?"ok":w.pos.acc<=120?"weak":"bad"}">${t("gpsAcc",{n:Math.round(w.pos.acc)})}</span>`;

    if(P && typeof P.key === "number"){
      main = `${P.key+1}. ${st[P.key].title}`;
      sub = P.simulated ? t("ttsNA") : t("speaking");
      acts.push(dockBtn("voice-stop", t("stopVoice"), "stop"));
    } else if(P && P.key === "intro"){
      main = t("walkStarts");
      sub = w.target >= 0 ? t("firstTarget", {n:w.target+1, title:st[w.target].title}) : "";
      acts.push(dockBtn("voice-stop", t("skip"), "stop"));
    } else if(P && P.key === "epilogue"){
      main = t("afterDay"); sub = w.hero.epilogue;
      acts.push(dockBtn("voice-stop", t("stopVoice"), "stop"));
    } else if(w.finished || w.target < 0){
      main = t("dayDone");
      sub = t("dayDoneText", {...heroVars(w.hero), epilogue:w.hero.epilogue});
      acts.push(dockBtn("walk-end", t("finish"), "check", true));
    } else if(w.err && w.err.code !== 3 && !w.pos){
      main = t("noGeo"); sub = geoErrText(w.err);
      acts.push(dockBtn("demo", t("demoWalk"), "demo", true));
    } else {
      const tg = st[w.target];
      main = t("nextStop", {n:w.target+1, title:tg.title});
      if(w.pos){
        const dm = dist(w.pos, tg);
        if(w.pos.acc > 120) sub = t("weakGps", {n:Math.round(w.pos.acc)});
        else if(dm > 3000) sub = t("farAway", {d:t("u_km",{n:km(dm)}), start:w.hero.start});
        else if(dm <= (tg.radius||45)*1.6) sub = t("almost", {d:fmtDist(dm)});
        else sub = t("walkEta", {d:fmtDist(dm*1.25), m:Math.max(1, Math.round(dm*1.25/75))}) + (tg.transit ? t("transitHint") : "");
      } else sub = w.err && w.err.code === 3 ? geoErrText(w.err) : t("locating");
      acts.push(dockBtn("arrive", t("arrivedBtn"), "check", true));
      acts.push(`<a class="btn small" href="${mapsNav(tg)}" target="_blank" rel="noopener">${ICON.out}${t("howToGet")}</a>`);
    }
    d.className = `dock walk h-${w.hero.id}`;
    d.innerHTML = `<div class="dock-in">
      <div class="dock-top">${chip}<span class="dock-hero">${t("walkWith", heroVars(w.hero))}</span><button type="button" class="dock-x" data-act="walk-end">${t("finish")} ✕</button></div>
      <div class="dock-main"><b>${main}</b><span>${sub}</span></div>
      ${acts.length?`<div class="dock-actions">${acts.join("")}</div>`:""}</div>`;
    d.hidden = false;
    return;
  }
  if(P){
    const h = heroById(P.hero.id) || P.hero;
    const title = typeof P.key === "number" ? `${h.stops[P.key].time} · ${P.title}` : P.title;
    const canNext = S.listen && typeof P.key === "number" && P.key < h.stops.length-1;
    d.className = `dock player h-${h.id}`;
    d.innerHTML = `<div class="dock-in row">
      <div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="dock-main"><b>${h.short}${S.listen?t("wholeDay"):""}</b><span>${title}${P.simulated?t("readText"):""}</span></div>
      ${canNext?dockBtn("next", t("next")):""}${dockBtn("player-stop", t("stop"), "stop", true)}</div>`;
    d.hidden = false;
    return;
  }
  d.hidden = true; d.innerHTML = "";
}

$("#dock").addEventListener("click", e=>{
  const b = e.target.closest("[data-act]"); if(!b) return;
  const act = b.dataset.act;
  if(act === "voice-stop") Voice.stop();
  else if(act === "walk-end") endWalk();
  else if(act === "arrive" && S.walk && S.walk.target >= 0) arrive(S.walk.target);
  else if(act === "demo"){ endWalk(true); startWalk(true); }
  else if(act === "player-stop") stopListen();
  else if(act === "next" && Voice.playing){ const P = Voice.playing; listen(heroById(P.hero.id), P.key+1, S.listen); }
});

/* ============================ home ============================ */
let sphereFilter = "all";
const SPHERES = ["all","music","painting","science","ballet","film"];

function installHTML(){
  if(isStandalone() || load(K.install, false)) return "";
  if(S.installEvt) return `<div class="install frame"><div><b>${t("installTitle")}</b><span>${t("installText")}</span></div>
    <div class="install-acts"><button class="btn small solid" type="button" data-install="go">${t("installBtn")}</button><button class="btn small" type="button" data-install="hide">${t("notNow")}</button></div></div>`;
  if(isIOS()) return `<div class="install frame"><div><b>${t("iosTitle")}</b><span>${t("iosText")}</span></div>
    <div class="install-acts"><button class="btn small" type="button" data-install="hide">${t("gotIt")}</button></div></div>`;
  return "";
}
function refreshInstall(){ const slot = $("#install-slot"); if(slot) slot.innerHTML = installHTML(); }

function renderHome(){
  destroyMap();
  S.hero = null;
  $("#app").innerHTML = `
  <div class="wrap">
    <div id="install-slot">${installHTML()}</div>
    <section class="intro">
      <div>
        <p class="eyebrow">${t("homeEyebrow")}</p>
        <h1>${t("homeTitle")}</h1>
        <p class="lead">${t("homeLead")}</p>
      </div>
      <div class="spheres" role="group" aria-label="${t("spheresAria")}">
        <p class="eyebrow">${t("spheresLabel")}</p>
        ${SPHERES.map(s=>`<button type="button" class="chip" data-sphere="${s}" aria-pressed="${s===sphereFilter}">${t("sphere_"+s)}</button>`).join("")}
      </div>
    </section>
  </div>
  <div class="wrap">
    ${DECO}
    <section class="section" id="heroes">
      <div class="section-head"><h2>${t("heroesTitle")}</h2><p>${t("heroesSub")}</p></div>
      <div class="cards">${LOC.heroes.map(heroCard).join("")}</div>
      <div class="soon">${LOC.upcoming.map(soonCard).join("")}</div>
      <p class="note is-hidden" id="empty-note">${t("emptyNote")}</p>
    </section>
    ${DECO}
    <section class="section" id="timeline">
      <div class="section-head"><h2>${t("tlTitle")}</h2><p>${t("tlSub")}</p></div>
      <div class="tl-box frame">${timelineSVG()}</div>
      <div class="tl-legend">
        <span><i style="width:18px;height:8px;background:var(--c-mozart)"></i>${t("tlYears")}</span>
        <span><i style="width:18px;height:8px;background:var(--line-strong)"></i>${t("tlSoon")}</span>
        <span><svg width="12" height="12" viewBox="0 0 12 12" style="vertical-align:middle;margin-right:6px"><path d="M6 1l5 5-5 5-5-5z" fill="var(--ink)"/></svg>${t("tlDay")}</span>
      </div>
      <div class="links">${LOC.links.map(linkCard).join("")}</div>
    </section>
    ${DECO}
    <section class="section" id="how">
      <div class="section-head"><h2>${t("howTitle")}</h2><p>${t("howSub")}</p></div>
      <div class="how">${LOC.how.map(([e,ti,p])=>`<div><p class="eyebrow">${e}</p><h4>${ti}</h4><p>${p}</p></div>`).join("")}</div>
    </section>
    ${footer()}
  </div>`;
  $$(".chip").forEach(b=>b.addEventListener("click", ()=>{ sphereFilter = b.dataset.sphere; applyFilter(); }));
  applyFilter();
}

function applyFilter(){
  $$(".chip").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.sphere === sphereFilter)));
  let shown = 0;
  $$("[data-card-sphere]").forEach(el=>{
    const ok = sphereFilter === "all" || el.dataset.cardSphere === sphereFilter;
    el.classList.toggle("is-hidden", !ok);
    if(ok && el.classList.contains("card")) shown++;
  });
  $("#empty-note")?.classList.toggle("is-hidden", shown > 0);
  $(".cards")?.classList.toggle("is-hidden", shown === 0);
}

function heroCard(h){
  const st = dayStats(h); const v = (visited[h.id]||[]).length;
  return `<a class="card frame h-${h.id}" href="#${h.id}" data-card-sphere="${h.sphere}">
    <div class="band" aria-hidden="true"></div>
    <div class="card-in">
      <div class="card-top">${monogram(h,48)}<p class="eyebrow">${t("sphere_"+h.sphere)}<br>${h.years}</p></div>
      <h3>${h.short}</h3>
      <p class="full">${h.name}</p>
      <div class="card-day"><span class="date">${h.date}</span><span>${h.dayTitle}</span></div>
      <div class="card-meta">${countWord("pl_places", st.places)} · ${t("walkKm",{d:t("u_km",{n:km(st.walkM)})})}${st.transit?` · ${countWord("pl_trips", st.transit)}`:""} · ≈ ${fmtMin(st.minutes)}</div>
      <div class="card-go"><span>${t("cardGo")}</span>${v?`<span class="prog">${t("progress",{n:v, t:h.stops.length})}</span>`:""}</div>
    </div>
  </a>`;
}
function soonCard(h){
  return `<div class="soon-card h-upcoming" data-card-sphere="${h.sphere}">
    <div class="row"><p class="eyebrow">${t("sphere_"+h.sphere)}</p><span class="tag">${t("soonTag")}</span></div>
    <h4>${h.name}</h4><p>${h.years}</p><p>${h.teaser}</p></div>`;
}
function heroChip(id){
  const h = anyById(id); if(!h) return "";
  return isActiveHero(id) ? `<a class="h-${id}" href="#${id}">${h.short}</a>` : `<span>${t("soonChip",{short:h.short})}</span>`;
}
function linkCard(l){
  return `<div class="link-card"><span class="yr">${l.year}</span><h4>${l.title}</h4><p>${l.text}</p>
    <div class="pair">${heroChip(l.a)}${heroChip(l.b)}${l.c?heroChip(l.c):""}</div></div>`;
}
function timelineSVG(){
  const rows = [...LOC.heroes, ...LOC.upcoming].sort((a,b)=>a.vienna[0][0]-b.vienna[0][0]);
  const X0 = 150, X1 = 885, Y1 = 1775, Y2 = 1950, TOP = 34, RH = 30;
  const x = y=>X0+(y-Y1)/(Y2-Y1)*(X1-X0);
  const yOf = id=>TOP+rows.findIndex(r=>r.id===id)*RH+RH/2;
  const H = TOP+rows.length*RH+10;
  let s = `<svg viewBox="0 0 900 ${H}" role="img" aria-label="${t("tlAria")}">`;
  for(let y=Y1;y<=Y2;y+=25) s += `<line class="tl-tick" x1="${x(y)}" y1="${TOP-8}" x2="${x(y)}" y2="${H-6}"/><text class="tl-year" x="${x(y)}" y="${TOP-14}" text-anchor="middle">${y}</text>`;
  LOC.links.forEach(l=>{
    const yr = +l.year, ys = [l.a,l.b,l.c].filter(Boolean).filter(id=>rows.some(r=>r.id===id)).map(yOf);
    s += `<line class="tl-conn" x1="${x(yr)}" x2="${x(yr)}" y1="${Math.min(...ys)}" y2="${Math.max(...ys)}"><title>${l.year}: ${l.title}</title></line>`;
    ys.forEach(yy=>{ s += `<circle class="tl-dot" cx="${x(yr)}" cy="${yy}" r="3.5"><title>${l.year}: ${l.title}</title></circle>`; });
  });
  rows.forEach((r,i)=>{
    const cy = TOP+i*RH+RH/2; const active = isActiveHero(r.id);
    const label = `<text class="tl-name${active?"":" up"}" x="0" y="${cy}" dominant-baseline="central">${r.short}${active?"":t("soonRow")}</text>`;
    s += active ? `<a class="tl-link" href="#${r.id}">${label}</a>` : label;
    r.vienna.forEach(([a,b])=>{
      s += `<rect x="${x(a)}" y="${cy-5}" width="${Math.max(4,x(b)-x(a))}" height="10" rx="2" ${active?`fill="var(--c-${r.id})"`:`class="tl-bar-up"`}><title>${r.name}: ${a}–${Math.floor(b)}</title></rect>`;
    });
    if(active){ const dx = x(r.dayYear); s += `<path d="M${dx} ${cy-9}l7 9-7 9-7-9z" fill="var(--ink)" stroke="var(--surface)" stroke-width="1.5"><title>${r.date}: ${r.dayTitle}</title></path>`; }
  });
  return s + "</svg>";
}
function footer(){
  return `<footer class="foot">
    ${DECO}
    <p>${t("footer1", {v:APP_VERSION})}</p>
    <p>${t("footer2")}</p>
  </footer>`;
}

/* ============================ hero page ============================ */
function renderHero(h, keepScroll){
  const y = window.scrollY;
  destroyMap();
  S.hero = h; S.active = -1;
  const stops = stopsOf(h);
  const st = dayStats(h); const L = legs(stops);
  const others = LOC.links.filter(l=>[l.a,l.b,l.c].includes(h.id));
  const nextHero = LOC.heroes[(LOC.heroes.findIndex(x=>x.id===h.id)+1)%LOC.heroes.length];
  $("#app").innerHTML = `
  <div class="h-${h.id}">
  <div class="wrap">
    <a class="back" href="#heroes">${t("back")}</a>
    <section class="hh">
      <div class="hh-top">
        <div class="mono-big">${monogram(h,72)}</div>
        <div>
          <p class="eyebrow">${t("sphere_"+h.sphere)} · ${h.years} · ${h.inVienna}</p>
          <h1>${h.name}</h1>
          <p class="hh-day"><span class="date">${h.date}</span><span>${h.dayTitle}</span></p>
        </div>
      </div>
      <p class="lede">${h.lede}</p>
      <ul class="stats">
        <li><b>${fmtNum(st.places)}</b><span>${tp("pl_places", st.places)}</span></li>
        <li><b>${t("u_km",{n:km(st.walkM)})}</b><span>${t("statWalk")}</span></li>
        ${st.transit?`<li><b>${fmtNum(st.transit)}</b><span>${tp("pl_trips", st.transit)}</span></li>`:""}
        <li><b>≈ ${fmtMin(st.minutes)}</b><span>${t("statTour")}</span></li>
        <li><b>${stops[0].time}–${stops[stops.length-1].time}</b><span>${t("statDay")}</span></li>
      </ul>
      <div class="actions">
        <button class="btn solid big" type="button" id="walk-start">${ICON.walk}${t("startWalk")}</button>
        <button class="btn" type="button" id="play-day" ${Voice.ok || recorded(h)?"":"disabled"}>${ICON.play}${t("listenDay")}</button>
        <button class="btn" type="button" id="walk-demo">${ICON.demo}${t("demoWalk")}</button>
        <a class="btn" href="${mapsRoute(stops)}" target="_blank" rel="noopener">${ICON.out}${t("routeMaps")}</a>
      </div>
      <p class="start-line">${ICON.pin}<span><b>${t("startLabel")}</b> ${h.start}</span></p>
      <details class="howto"><summary>${t("howToUse")}</summary><p>${t("walkNote")}</p><p id="voice-note">${voiceNote()}</p></details>
    </section>
    ${DECO}
    <section class="day">
      <aside class="mapcard frame" aria-label="${t("mapAria",{title:h.dayTitle})}">
        <div id="map"></div>
        <div class="map-foot">
          <div class="progress"><span class="bar"><i id="prog-bar"></i></span><span id="prog-txt"></span></div>
          <span class="legend"><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--hc)" stroke-width="2.5"/></svg> ${t("legendWalk")}
          ${st.transit?`<svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--hc)" stroke-width="3" stroke-dasharray="2 5" stroke-linecap="round"/></svg> ${t("legendTransit")}`:""}
          <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--me)" stroke="var(--surface)" stroke-width="2"/></svg> ${t("legendMe")}</span>
        </div>
        <p class="mapnote" id="map-note">${t("mapNoteCity")}</p>
      </aside>
      <div class="stops">
        ${stops.map((s,i)=>stopHTML(h,s,i,L[i])).join("")}
        <div class="epilogue"><p class="eyebrow">${t("afterDay")}</p><p>${h.epilogue}</p></div>
      </div>
    </section>
    ${others.length?`<section class="hero-links">
      <div class="section-head"><h2>${t("linksTitle")}</h2><p>${t("linksSub", heroVars(h))}</p></div>
      <div class="links n${others.length}" style="margin-top:0">${others.map(linkCard).join("")}</div>
    </section>`:""}
    <div class="next-hero">
      <span class="eyebrow">${t("nextDay")}</span>
      <a class="btn h-${nextHero.id}" href="#${nextHero.id}">${nextHero.short}: ${nextHero.dayTitle} →</a>
    </div>
    ${footer()}
  </div>
  </div>`;
  wireHero(h);
  refreshMarks(); markTarget(); updateVoiceUI();
  mountMap(h, stops);
  if(keepScroll) window.scrollTo({top:y, behavior:"instant"});
}

function stopHTML(h, s, i, leg){
  const v = isVisited(h.id, i);
  let legHTML = "";
  if(leg){
    if(leg.same) legHTML = `<div class="leg">${ICON.walk}<span>${t("sameHouse")}</span></div>`;
    else if(leg.transit) legHTML = `<div class="leg transit">${ICON.tram}<span>${t("legTransit",{d:t("u_km",{n:km(leg.d)}), go:s.go})}</span></div>`;
    else legHTML = `<div class="leg">${ICON.walk}<span>${t("legWalk",{d:fmtDist(leg.walk), m:Math.max(1, Math.round(leg.walk/75))})}</span></div>`;
  }
  const calib = settings.calibrate ? `<div class="calib">
      <button class="btn small" type="button" data-calib="${i}">${ICON.pin}${t("calibBtn")}</button>
      ${s.calibrated?`<span class="cal-ok">${t("calibOk")}</span>`:s.approx?`<span class="cal-approx">${t("calibApprox")}</span>`:`<span class="cal-muted">${t("calibRef")}</span>`}
    </div>` : "";
  return `${legHTML}
  <article class="stop${v?" v":""}" id="stop-${i}" data-i="${i}">
    <div class="stop-card frame">
      <header class="stop-head"><span class="num">${i+1}</span>
        <div class="stop-title"><span class="time">${s.time}</span><h3>${s.title}</h3></div>
      </header>
      <p class="place">${s.place} · ${s.addr}</p>
      <blockquote class="voice">${s.voice}</blockquote>
      <p class="src">${s.src}</p>
      <div class="stop-actions">
        <button class="btn small solid" type="button" data-speak="${i}">${ICON.play}${t("voiceBtn")}</button>
        <button class="btn small" type="button" data-visit="${i}" aria-pressed="${v}">${ICON.check}${v?t("visited"):t("imHere")}</button>
        <a class="btn small" href="${mapsSearch(s.addr)}" target="_blank" rel="noopener">${ICON.out}${t("onMap")}</a>
      </div>
      ${calib}
      ${s.moment==="hearing"?momentHTML():""}
      <div class="facts">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected="true" data-tab="fact">${t("factLabel")}</button>
          <button type="button" role="tab" aria-selected="false" data-tab="now">${t("nowLabel")}</button>
        </div>
        <p data-pane="fact">${s.fact}</p>
        <p data-pane="now" hidden>${s.now}</p>
      </div>
    </div>
  </article>`;
}

function momentHTML(){
  return `<div class="moment">
    <p class="eyebrow">${t("momentEyebrow")}</p>
    <h4>${t("hearTitle")}</h4>
    <p>${t("hearDesc")}</p>
    <div class="moment-ctl">
      <button class="btn small solid" type="button" id="hear-play">${ICON.play}${t("hearPlay")}</button>
      <div class="seg" role="group" aria-label="${t("hearAria")}">
        <button type="button" data-mode="ries" aria-pressed="${Hear.mode!=="lvb"}">${t("hearRies")}</button>
        <button type="button" data-mode="lvb" aria-pressed="${Hear.mode==="lvb"}">${t("hearLvb")}</button>
      </div>
    </div>
    <canvas id="hear-spec" style="color:var(--hc)" aria-label="${t("hearCanvas")}"></canvas>
    <div class="spec-legend"><span>${t("hearLow")}</span><span>${t("hearHigh")}</span></div>
  </div>`;
}
function stopHearing(){ Hear.stop($("#hear-spec")); const b = $("#hear-play"); if(b) b.innerHTML = ICON.play+t("hearPlay"); }

function wireHero(h){
  $("#walk-start").addEventListener("click", ()=>startWalk(false));
  $("#walk-demo").addEventListener("click", ()=>startWalk(true));
  $("#play-day").addEventListener("click", ()=>{
    if(S.listen && Voice.playing){ stopListen(); return; }
    if(S.walk) endWalk(true);
    Voice.broken = false; prefetchAudio(h); listen(h, 0, true);
  });
  $$("[data-speak]").forEach(b=>b.addEventListener("click", e=>{
    e.stopPropagation(); const i = +b.dataset.speak;
    const P = Voice.playing;
    if(P && sameHero(P.hero, h) && P.key === i){ Voice.stop(); S.listen = false; return; }
    Voice.broken = false;
    if(S.walk){ const s = S.walk.stops[i]; Voice.say(S.walk.hero, i, s.title, s.voice, audioFor(S.walk.hero, i), null); }
    else listen(h, i, false);
  }));
  $$("[data-visit]").forEach(b=>b.addEventListener("click", e=>{
    e.stopPropagation(); const i = +b.dataset.visit;
    setVisited(h.id, i, !isVisited(h.id, i)); syncVisitUI(i);
    if(S.walk){ isVisited(h.id,i) ? S.walk.done.add(i) : S.walk.done.delete(i); S.walk.target = nextTarget(); markTarget(); renderDock(); }
  }));
  $$("[data-calib]").forEach(b=>b.addEventListener("click", e=>{ e.stopPropagation(); calibrate(h, +b.dataset.calib); }));
  $$(".tabs button").forEach(b=>b.addEventListener("click", e=>{
    e.stopPropagation(); const f = b.closest(".facts");
    $$(".tabs button", f).forEach(x=>x.setAttribute("aria-selected", String(x === b)));
    $$("[data-pane]", f).forEach(p=>{ p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
  $$(".stop").forEach(el=>el.addEventListener("click", e=>{ if(e.target.closest("a,button")) return; setActive(+el.dataset.i, false); }));
  const hp = $("#hear-play");
  if(hp){
    hp.addEventListener("click", e=>{
      e.stopPropagation();
      if(Hear.on){ stopHearing(); return; }
      if(Hear.start($("#hear-spec"))) hp.innerHTML = ICON.stop+t("stopBtn");
      else hp.textContent = t("hearNA");
    });
    $$(".seg button").forEach(b=>b.addEventListener("click", e=>{
      e.stopPropagation(); Hear.setMode(b.dataset.mode);
      $$(".seg button").forEach(x=>x.setAttribute("aria-pressed", String(x === b)));
    }));
  }
}

function syncVisitUI(i){
  if(!S.hero) return;
  const v = isVisited(S.hero.id, i);
  const card = $(`#stop-${i}`); if(card) card.classList.toggle("v", v);
  const b = $(`[data-visit="${i}"]`); if(b){ b.setAttribute("aria-pressed", String(v)); b.innerHTML = ICON.check+(v?t("visited"):t("imHere")); }
  refreshMarks();
}

function setActive(i, scroll){
  S.active = i;
  if(MAP && !scroll && !(S.walk && !S.walk.finished)) MAP.focus(i);
  $$(".stop").forEach(el=>el.classList.toggle("on", +el.dataset.i === i));
  refreshMarks();
  if(scroll){ const el = $(`#stop-${i} .stop-card`); if(el) el.scrollIntoView({behavior:reduceMotion?"auto":"smooth", block:"center"}); }
}
function refreshMarks(){
  if(!S.hero) return;
  $$("#map .mk").forEach(g=>{
    const ids = g.dataset.i.split(",").map(Number);
    g.classList.toggle("on", ids.includes(S.active));
    g.classList.toggle("v", ids.some(i=>isVisited(S.hero.id, i)));
  });
  if(MAP) MAP.setState({active:S.active, visited:new Set(visited[S.hero.id]||[]), target: S.walk && !S.walk.finished ? S.walk.target : -1});
  const n = (visited[S.hero.id]||[]).length, total = S.hero.stops.length;
  const bar = $("#prog-bar"), txt = $("#prog-txt");
  if(bar) bar.style.width = (n/total*100)+"%";
  if(txt) txt.textContent = t("progress", {n, t:total});
}

/* ============================ калибровка координат ============================ */
async function calibrate(h, i){
  let pos = S.lastPos && Date.now()-S.lastPos.ts < 20000 && !S.lastPos.demo ? S.lastPos : null;
  if(!pos){
    toast(t("toastLocating"), null, null, 0);
    try{ pos = await Geo.once(); S.lastPos = pos; }
    catch(e){ toast(geoErrText(e) || t("toastCalibFail"), null, null, 7000); return; }
  }
  if(pos.acc > 35){ toast(t("toastCalibAcc", {n:Math.round(pos.acc)}), null, null, 6000); return; }
  overrides[h.id] = overrides[h.id] || {};
  overrides[h.id][i] = {lat:+pos.lat.toFixed(6), lng:+pos.lng.toFixed(6), acc:Math.round(pos.acc), title:CONTENT.ru.heroes[h.id].stops[i].title};
  save(K.overrides, overrides);
  if(S.walk && sameHero(S.walk.hero, h)) S.walk.stops = stopsOf(S.walk.hero);
  renderHero(h, true);
  toast(t("toastCalibSaved", {i:i+1, title:h.stops[i].title, n:Math.round(pos.acc)}));
}

/* ============================ settings ============================ */
function overridesCount(){ return Object.values(overrides).reduce((a,o)=>a+Object.keys(o).length, 0); }
function openSettings(){
  const dlg = $("#settings");
  const nVisited = Object.values(visited).reduce((a,v)=>a+v.length, 0);
  const nOv = overridesCount();
  const sw = "serviceWorker" in navigator && navigator.serviceWorker.controller;
  dlg.setAttribute("aria-label", t("set_title"));
  dlg.innerHTML = `<form method="dialog" class="set">
    <div class="set-head"><h3>${t("set_title")}</h3><button class="btn small" value="close">${t("set_done")}</button></div>
    <label class="set-lang"><span>${t("set_lang")}</span><select id="set-lang">${LANGS.map(l=>`<option value="${l.code}" ${l.code===lang()?"selected":""}>${l.name}</option>`).join("")}</select></label>
    ${Voice.ok ? `<div class="set-voice">
      <label for="set-voice"><b>${t("set_voice")}</b></label>
      <div class="set-voice-row">
        <select id="set-voice">${Voice.voices().length ? `<option value="">${t("set_voiceAuto")}${Voice.voice?" · "+Voice.voice.name:""}</option>`+Voice.voices().map(v=>`<option value="${v.voiceURI}" ${settings.voices[lang()]===v.voiceURI?"selected":""}>${v.name}</option>`).join("") : `<option value="">${t("set_voiceNone")}</option>`}</select>
        <button class="btn small" type="button" id="set-voice-test" ${Voice.voices().length?"":"disabled"}>${t("set_voiceTest")}</button>
      </div>
      <small>${(RECORDINGS[lang()]||[]).length ? t("voiceRecorded")+" " : ""}${t("set_voiceNote")}</small>
    </div>` : ""}
    <label class="sw"><input type="checkbox" id="set-autoVoice" ${settings.autoVoice?"checked":""}><span><b>${t("set_autoVoice")}</b><small>${t("set_autoVoiceDesc")}</small></span></label>
    <label class="sw"><input type="checkbox" id="set-vibrate" ${settings.vibrate?"checked":""}><span><b>${t("set_vibrate")}</b><small>${t("set_vibrateDesc")}</small></span></label>
    <label class="sw"><input type="checkbox" id="set-calibrate" ${settings.calibrate?"checked":""}><span><b>${t("set_calib")}</b><small>${t("set_calibDesc")}</small></span></label>
    <div class="set-voice"><b>${t("set_palette")}</b>
      <div class="palettes" role="radiogroup" aria-label="${t("set_palette")}">${PALETTES.map(p=>`<label><input type="radio" name="palette" value="${p.id}" ${settings.palette===p.id?"checked":""}><span class="sw-row">${p.sw.map(c=>`<i style="background:${c}"></i>`).join("")}</span>${t("pal_"+p.id)}</label>`).join("")}</div>
    </div>
    <div class="set-row"><span>${t("set_visited",{n:nVisited})}</span><button class="btn small" type="button" id="set-reset" ${nVisited?"":"disabled"}>${t("set_reset")}</button></div>
    <div class="set-row"><span>${t("set_overrides",{n:nOv})}</span>
      <span class="set-acts"><button class="btn small" type="button" id="set-copy" ${nOv?"":"disabled"}>${t("set_copy")}</button><button class="btn small" type="button" id="set-clear" ${nOv?"":"disabled"}>${t("set_delete")}</button></span></div>
    <textarea id="set-json" readonly hidden></textarea>
    <p class="set-note">${sw?t("set_offlineOn"):t("set_offlineOff")}<br>${t("set_version",{v:APP_VERSION})}</p>
  </form>`;
  $("#set-lang", dlg).addEventListener("change", e=>{ changeLanguage(e.target.value); openSettings(); });
  $$('input[name="palette"]', dlg).forEach(r=>r.addEventListener("change", e=>{ settings.palette = e.target.value; save(K.settings, settings); applyPalette(); }));
  const vs = $("#set-voice", dlg);
  if(vs){
    vs.addEventListener("change", e=>{
      const uri = e.target.value; settings.voices = settings.voices || {};
      if(uri) settings.voices[lang()] = uri; else delete settings.voices[lang()];
      save(K.settings, settings); Voice.choose(uri); updateVoiceUI();
    });
    $("#set-voice-test", dlg).addEventListener("click", ()=>Voice.sample(t("voiceSample")));
  }
  const bind = (id, key)=>$("#"+id, dlg).addEventListener("change", e=>{
    settings[key] = e.target.checked; save(K.settings, settings);
    if(key === "calibrate" && S.hero) renderHero(S.hero, true);
  });
  bind("set-autoVoice","autoVoice"); bind("set-vibrate","vibrate"); bind("set-calibrate","calibrate");
  $("#set-reset", dlg).addEventListener("click", ()=>{
    visited = {}; save(K.visited, visited);
    if(S.walk){ S.walk.done.clear(); S.walk.target = nextTarget(); }
    if(S.hero) renderHero(S.hero, true); else renderHome();
    openSettings(); toast(t("toastVisitsReset"));
  });
  $("#set-copy", dlg).addEventListener("click", ()=>{
    const json = JSON.stringify(overrides, null, 2);
    const ta = $("#set-json", dlg); ta.value = json;
    const fallback = ()=>{ ta.hidden = false; ta.focus(); ta.select(); toast(t("toastCopyManual")); };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(()=>toast(t("toastCopied")), fallback);
    else fallback();
  });
  $("#set-clear", dlg).addEventListener("click", ()=>{
    overrides = {}; save(K.overrides, overrides);
    if(S.walk) S.walk.stops = stopsOf(S.walk.hero);
    if(S.hero) renderHero(S.hero, true);
    openSettings(); toast(t("toastCleared"));
  });
  if(!dlg.open){ if(dlg.showModal) dlg.showModal(); else dlg.setAttribute("open",""); }
}
$("#open-settings").addEventListener("click", openSettings);

/* ============================ install & service worker ============================ */
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); S.installEvt = e; refreshInstall(); });
window.addEventListener("appinstalled", ()=>{ S.installEvt = null; refreshInstall(); toast(t("toastInstalled")); });
document.addEventListener("click", e=>{
  const b = e.target.closest("[data-install]"); if(!b) return;
  if(b.dataset.install === "go" && S.installEvt){ S.installEvt.prompt(); S.installEvt.userChoice.finally(()=>{ S.installEvt = null; refreshInstall(); }); }
  if(b.dataset.install === "hide"){ save(K.install, true); refreshInstall(); }
});

let updating = false;
if("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){
  navigator.serviceWorker.register("./sw.js").then(reg=>{
    reg.addEventListener("updatefound", ()=>{
      const nw = reg.installing; if(!nw) return;
      nw.addEventListener("statechange", ()=>{
        if(nw.state !== "installed") return;
        if(navigator.serviceWorker.controller) toast(t("toastNewVersion"), t("toastUpdate"), ()=>{ updating = true; nw.postMessage("skipWaiting"); }, 0);
        else toast(t("toastOfflineReady"));
      });
    });
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener("controllerchange", ()=>{ if(updating) location.reload(); });
}

function netStatus(){ const n = $("#net"); if(n) n.hidden = navigator.onLine !== false; }
window.addEventListener("online", netStatus); window.addEventListener("offline", netStatus);

/* ============================ router ============================ */
function route(){
  const h = (location.hash||"").slice(1);
  const hero = heroById(h);
  if(Hear.on) Hear.stop();
  if(S.walk && (!hero || hero.id !== S.walk.hero.id)){ endWalk(true); toast(t("toastWalkStopped")); }
  if(!S.walk){ S.listen = false; Voice.stop(); }
  if(hero){ renderHero(hero); window.scrollTo({top:0, behavior:"instant"}); }
  else {
    if(!$("#heroes")) renderHome();
    if(h && h !== "top"){ const el = document.getElementById(h); if(el) el.scrollIntoView(); }
    else window.scrollTo({top:0, behavior:"instant"});
  }
  renderDock();
}

/* ============================ start ============================ */
applyPalette();
applyLanguage(detectLang(load(K.lang, null)));
Voice.init(langInfo().tts, settings.voices);
netStatus();
window.addEventListener("hashchange", route);
route();
