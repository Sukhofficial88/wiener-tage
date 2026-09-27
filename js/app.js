import { HEROES, UPCOMING, LINKS, HOW } from "./data.js";
import { Geo, dist } from "./geo.js";
import { Voice, Hear } from "./audio.js";
import { mapSVG, updateMe } from "./map.js";

const APP_VERSION = "0.2.0";

/* ============================ helpers ============================ */
const $ = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>[...el.querySelectorAll(s)];
const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ALL = [...HEROES, ...UPCOMING];
const byId = id => ALL.find(h=>h.id===id);

const km = m => (m/1000).toFixed(1).replace(".", ",");
const fmtDist = m => m >= 1000 ? km(m)+" км" : Math.max(10, Math.round(m/10)*10)+" м";
function fmtMin(min){
  min = Math.max(10, Math.round(min/10)*10);
  const h = Math.floor(min/60), m = min%60;
  return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
}
function plural(n, one, few, many){
  const a = n%10, b = n%100;
  if(a===1 && b!==11) return one;
  if(a>=2 && a<=4 && (b<12 || b>14)) return few;
  return many;
}

/* ============================ storage ============================ */
const K = {visited:"wt-visited-v1", settings:"wt-settings-v1", overrides:"wt-overrides-v1", install:"wt-install-hidden"};
function load(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

let visited = load(K.visited, {}) || {};
let settings = Object.assign({autoVoice:true, vibrate:true, calibrate:false}, load(K.settings, {}) || {});
let overrides = load(K.overrides, {}) || {};

const isVisited = (id, i)=> (visited[id]||[]).includes(i);
function setVisited(id, i, v){
  const a = new Set(visited[id]||[]); v ? a.add(i) : a.delete(i);
  visited[id] = [...a].sort((x,y)=>x-y); save(K.visited, visited);
}
function stopsOf(h){
  const o = overrides[h.id] || {};
  return h.stops.map((s,i)=> o[i] ? {...s, lat:o[i].lat, lng:o[i].lng, calibrated:true} : s);
}

function legs(stops){
  return stops.map((s,i)=>{
    if(!i) return null;
    const d = dist(stops[i-1], s);
    return {d, walk:d*1.3, transit:!!s.go, same:d<25};
  });
}
function dayStats(h){
  const st = stopsOf(h); const L = legs(st).filter(Boolean);
  const walkM = L.filter(l=>!l.transit).reduce((a,l)=>a+l.walk, 0);
  const transit = L.filter(l=>l.transit).length;
  const places = new Set(st.map(s=>s.addr)).size;
  return {walkM, transit, places, minutes: walkM/75 + st.length*12 + transit*35};
}
const mapsSearch = addr => "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(addr);
const mapsNav = s => "https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(s.addr)+"&travelmode="+(s.go?"transit":"walking");
function mapsRoute(stops){
  const a = []; stops.forEach(s=>{ if(a[a.length-1] !== s.addr) a.push(s.addr); });
  const o = a[0], d = a[a.length-1], w = a.slice(1,-1);
  return "https://www.google.com/maps/dir/?api=1&travelmode=walking&origin="+encodeURIComponent(o)+"&destination="+encodeURIComponent(d)+(w.length?"&waypoints="+encodeURIComponent(w.join("|")):"");
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
  return `<svg width="${s}" height="${s}" viewBox="0 0 60 60" role="img" aria-label="${h.name}">
    <rect x="1" y="1" width="58" height="58" fill="none" stroke="var(--hc)" stroke-width="1.5"/>
    <rect x="6" y="6" width="48" height="48" fill="none" stroke="var(--hc)" stroke-width=".75"/>
    ${[[1,1],[53,1],[1,53],[53,53]].map(([x,y])=>`<rect x="${x}" y="${y}" width="3" height="3" fill="var(--hc)"/><rect x="${x+3}" y="${y+3}" width="3" height="3" fill="var(--hc)"/>`).join("")}
    <text x="30" y="32" text-anchor="middle" dominant-baseline="central" font-family="Forum, Georgia, serif" font-size="${h.mono.length>2?17:22}" fill="var(--hc)" letter-spacing="1">${h.mono}</text>
  </svg>`;
}

function toast(msg, actionLabel, action, ms){
  const t = $("#toast");
  t.innerHTML = `<span>${msg}</span>${actionLabel?`<button class="btn small solid" type="button">${actionLabel}</button>`:""}`;
  t.hidden = false;
  if(actionLabel) t.querySelector("button").onclick = ()=>{ t.hidden = true; action(); };
  clearTimeout(toast.tm);
  if(ms !== 0) toast.tm = setTimeout(()=>{ t.hidden = true; }, ms || 4500);
}

const isStandalone = ()=> (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const isIOS = ()=> /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ============================ state ============================ */
const S = {hero:null, active:-1, walk:null, listen:false, installEvt:null, lastPos:null};

/* ============================ voice glue ============================ */
Voice.init();
Voice.on(()=>{ setTimeout(onVoiceIdle, 0); updateVoiceUI(); });

function listen(h, i, auto){
  const st = stopsOf(h); const s = st[i]; if(!s) return;
  S.listen = !!auto;
  setActive(i, true);
  Voice.say(h, i, s.title, s.voice, s.audio||null, ()=>{
    if(S.listen && i < st.length-1 && S.hero === h){
      setTimeout(()=>{ if(S.listen && !Voice.playing && S.hero === h) listen(h, i+1, true); }, 900);
    } else S.listen = false;
  });
}
function stopListen(){ S.listen = false; Voice.stop(); }

function updateVoiceUI(){
  const P = Voice.playing;
  $$(".voice.speaking").forEach(v=>v.classList.remove("speaking"));
  $$("[data-speak]").forEach(b=>{ b.innerHTML = ICON.play+"Голос героя"; });
  if(P && S.hero && P.hero === S.hero && typeof P.key === "number"){
    const card = $(`#stop-${P.key}`);
    if(card){ $(".voice", card)?.classList.add("speaking"); const b = $("[data-speak]", card); if(b) b.innerHTML = ICON.stop+"Остановить"; }
  }
  const pd = $("#play-day");
  if(pd) pd.innerHTML = (P && S.listen) ? ICON.stop+"Остановить" : ICON.play+"Слушать весь день";
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
  const t = stops[S.walk.target];
  document.body.classList.add("walking");
  if(settings.autoVoice) Voice.unlock(`Прогулка ${h.ins} начинается. ${S.walk.target===0?"Первая точка":"Следующая точка"}: ${t.title}.`, h);
  else Voice.unlock(null);
  lockScreen();
  if(demo) Geo.demo(stops, onPos, ()=>!!Voice.playing || !!(S.walk && S.walk.pending.length), ()=>{});
  else Geo.start(onPos, onGeoErr);
  markTarget(); renderDock();
}

function endWalk(silent){
  if(!S.walk) return;
  Geo.stop(); releaseScreen();
  S.walk = null;
  Voice.stop();
  updateMe(null);
  document.body.classList.remove("walking");
  markTarget(); renderDock();
  if(!silent) toast("Прогулка завершена. Отметки о пройденных местах сохранены.");
}

function onPos(pos){
  const w = S.walk; if(!w) return;
  w.pos = pos; w.err = null; S.lastPos = pos;
  updateMe(pos);
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
  if(e.code === 1) return "Нет доступа к геопозиции. Разрешите его для этого сайта в настройках браузера (iPhone: Настройки → Конфиденциальность → Службы геолокации). Если приложение открыто внутри Claude, GPS там недоступен: откройте его по собственному адресу.";
  if(e.code === 2) return "Телефон не может определить место. Проверьте, что геолокация включена.";
  if(e.code === 3) return "GPS долго не отвечает, продолжаем искать…";
  return "Этот браузер не умеет определять геопозицию.";
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
  Voice.say(w.hero, i, s.title, s.voice, s.audio||null, null);
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
  if(settings.autoVoice) Voice.say(w.hero, "epilogue", "После этого дня", w.hero.epilogue, null, null);
}

function markTarget(){
  const t = S.walk && !S.walk.finished ? S.walk.target : -1;
  $$("#map .mk").forEach(g=>g.classList.toggle("tg", g.dataset.i.split(",").map(Number).includes(t)));
}

/* ============================ dock (нижняя панель) ============================ */
function dockBtn(act, label, icon, solid){ return `<button type="button" class="btn small${solid?" solid":""}" data-act="${act}">${icon?ICON[icon]:""}${label}</button>`; }

function renderDock(){
  const d = $("#dock"); if(!d) return;
  const w = S.walk; const P = Voice.playing;
  if(w){
    const st = w.stops;
    let chip, main, sub = "", acts = [];
    if(w.demo) chip = `<span class="gps demo">Демо</span>`;
    else if(w.err && w.err.code !== 3 && !w.pos) chip = `<span class="gps bad">GPS недоступен</span>`;
    else if(!w.pos) chip = `<span class="gps wait">Ищем GPS…</span>`;
    else chip = `<span class="gps ${w.pos.acc<=30?"ok":w.pos.acc<=120?"weak":"bad"}">GPS ±${Math.round(w.pos.acc)} м</span>`;

    if(P && typeof P.key === "number"){
      main = `${P.key+1}. ${st[P.key].title}`;
      sub = P.simulated ? "Синтез речи недоступен: прочитайте монолог на экране" : "Звучит голос героя";
      acts.push(dockBtn("voice-stop", "Остановить голос", "stop"));
    } else if(P && P.key === "intro"){
      main = "Прогулка начинается";
      sub = w.target >= 0 ? `Первая цель: ${w.target+1}. ${st[w.target].title}` : "";
      acts.push(dockBtn("voice-stop", "Пропустить", "stop"));
    } else if(P && P.key === "epilogue"){
      main = "После этого дня"; sub = w.hero.epilogue;
      acts.push(dockBtn("voice-stop", "Остановить голос", "stop"));
    } else if(w.finished || w.target < 0){
      main = "День пройден";
      sub = `Вы побывали во всех местах дня ${w.hero.gen}. ${w.hero.epilogue}`;
    } else if(w.err && w.err.code !== 3 && !w.pos){
      main = "Нет геопозиции"; sub = geoErrText(w.err);
      acts.push(dockBtn("demo", "Демо-прогулка", "demo", true));
    } else {
      const t = st[w.target];
      main = `Дальше: ${w.target+1}. ${t.title}`;
      if(w.pos){
        const dm = dist(w.pos, t);
        if(w.pos.acc > 120) sub = `Сигнал GPS слабый (±${Math.round(w.pos.acc)} м). Выйдите на открытое место.`;
        else if(dm > 3000) sub = `До точки ${km(dm)} км по прямой. ${w.hero.start}`;
        else if(dm <= (t.radius||45)*1.6) sub = `Вы почти у цели, ${fmtDist(dm)}. Голос включится, как только подойдёте ближе.`;
        else sub = `≈ ${fmtDist(dm*1.25)} · ${Math.max(1, Math.round(dm*1.25/75))} мин пешком${t.go?" · этот отрезок удобнее на транспорте":""}`;
      } else sub = w.err && w.err.code === 3 ? geoErrText(w.err) : "Определяем, где вы…";
      acts.push(dockBtn("arrive", "Я на месте", "check", true));
      acts.push(`<a class="btn small" href="${mapsNav(t)}" target="_blank" rel="noopener">${ICON.out}Как пройти</a>`);
    }
    acts.push(dockBtn("walk-end", "Завершить"));
    d.className = `dock walk h-${w.hero.id}`;
    d.innerHTML = `<div class="dock-in">
      <div class="dock-top">${chip}<span class="dock-hero">Прогулка ${w.hero.ins}</span></div>
      <div class="dock-main"><b>${main}</b><span>${sub}</span></div>
      <div class="dock-actions">${acts.join("")}</div></div>`;
    d.hidden = false;
    return;
  }
  if(P){
    const h = P.hero;
    const title = typeof P.key === "number" ? `${h.stops[P.key].time} · ${P.title}` : P.title;
    const canNext = S.listen && typeof P.key === "number" && P.key < h.stops.length-1;
    d.className = `dock player h-${h.id}`;
    d.innerHTML = `<div class="dock-in row">
      <div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="dock-main"><b>${h.short}${S.listen?" · весь день":""}</b><span>${title}${P.simulated?" · читайте текст":""}</span></div>
      ${canNext?dockBtn("next","Дальше"):""}${dockBtn("player-stop","Стоп","stop",true)}</div>`;
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
  else if(act === "next" && Voice.playing){ const P = Voice.playing; listen(P.hero, P.key+1, S.listen); }
});

/* ============================ home ============================ */
let sphereFilter = "Все";

function installHTML(){
  if(isStandalone() || load(K.install, false)) return "";
  if(S.installEvt) return `<div class="install"><div><b>Установите приложение</b><span>Оно появится на экране телефона и будет работать без интернета.</span></div>
    <div class="install-acts"><button class="btn small solid" type="button" data-install="go">Установить</button><button class="btn small" type="button" data-install="hide">Не сейчас</button></div></div>`;
  if(isIOS()) return `<div class="install"><div><b>Установите на iPhone</b><span>В Safari нажмите «Поделиться», затем «На экран Домой». Приложение откроется без адресной строки и будет работать без интернета.</span></div>
    <div class="install-acts"><button class="btn small" type="button" data-install="hide">Понятно</button></div></div>`;
  return "";
}
function refreshInstall(){ const slot = $("#install-slot"); if(slot){ slot.innerHTML = installHTML(); } }

function renderHome(){
  S.hero = null;
  const spheres = ["Все","Музыка","Живопись","Наука","Балет","Кино"];
  $("#app").innerHTML = `
  <div class="wrap">
    <div id="install-slot">${installHTML()}</div>
    <section class="intro">
      <div>
        <p class="eyebrow">Вена · пилотная версия</p>
        <h1>Один день<br>с великим венцем</h1>
        <p class="lead">Выберите героя и пройдите его день по тем же улицам и в том же порядке: дом, где он проснулся, кафе, мастерская, театр. Начните прогулку, и у каждой двери зазвучит его голос: монолог по письмам и воспоминаниям.</p>
      </div>
      <div class="spheres" role="group" aria-label="Фильтр по сферам">
        <p class="eyebrow">Сферы</p>
        ${spheres.map(s=>`<button type="button" class="chip" data-sphere="${s}" aria-pressed="${s===sphereFilter}">${s}</button>`).join("")}
      </div>
    </section>
  </div>
  <div class="check" aria-hidden="true"></div>
  <div class="wrap">
    <section class="section" id="heroes">
      <div class="section-head"><h2>Дни, которые можно прожить</h2><p>Четыре маршрута готовы. Остальные герои в работе.</p></div>
      <div class="cards">${HEROES.map(heroCard).join("")}</div>
      <div class="soon">${UPCOMING.map(soonCard).join("")}</div>
      <p class="note is-hidden" id="empty-note">В готовых маршрутах этой сферы пока нет, ниже герои, которые появятся.</p>
    </section>
    <section class="section" id="timeline">
      <div class="section-head"><h2>Вена как общая сцена</h2><p>Годы, которые каждый герой прожил в Вене. Ромб отмечает день маршрута, пунктир показывает связь между героями.</p></div>
      <div class="tl-box">${timelineSVG()}</div>
      <div class="tl-legend">
        <span><i style="width:18px;height:8px;background:var(--c-mozart)"></i>годы в Вене</span>
        <span><i style="width:18px;height:8px;background:var(--line-strong)"></i>герой скоро появится</span>
        <span><svg width="12" height="12" viewBox="0 0 12 12" style="vertical-align:middle;margin-right:6px"><path d="M6 1l5 5-5 5-5-5z" fill="var(--ink)"/></svg>день маршрута</span>
      </div>
      <div class="links">${LINKS.map(linkCard).join("")}</div>
    </section>
    <section class="section" id="how">
      <div class="section-head"><h2>Как это работает</h2><p>Что уже умеет пилотная версия и что появится дальше.</p></div>
      <div class="how">${HOW.map(([e,t,p])=>`<div><p class="eyebrow">${e}</p><h4>${t}</h4><p>${p}</p></div>`).join("")}</div>
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
    const ok = sphereFilter === "Все" || el.dataset.cardSphere === sphereFilter;
    el.classList.toggle("is-hidden", !ok);
    if(ok && el.classList.contains("card")) shown++;
  });
  $("#empty-note")?.classList.toggle("is-hidden", shown > 0);
  $(".cards")?.classList.toggle("is-hidden", shown === 0);
}

function heroCard(h){
  const st = dayStats(h); const v = (visited[h.id]||[]).length;
  return `<a class="card h-${h.id}" href="#${h.id}" data-card-sphere="${h.sphere}">
    <div class="band" aria-hidden="true"></div>
    <div class="card-in">
      <div class="card-top">${monogram(h,48)}<p class="eyebrow">${h.sphere}<br>${h.years}</p></div>
      <h3>${h.short}</h3>
      <p class="full">${h.name}</p>
      <div class="card-day"><span class="date">${h.date}</span><span>${h.dayTitle}</span></div>
      <div class="card-meta">${st.places} ${plural(st.places,"место","места","мест")} · ${km(st.walkM)} км пешком${st.transit?` · ${st.transit} ${plural(st.transit,"поездка","поездки","поездок")}`:""} · ≈ ${fmtMin(st.minutes)}</div>
      <div class="card-go"><span>Прожить день →</span>${v?`<span class="prog">пройдено ${v} из ${h.stops.length}</span>`:""}</div>
    </div>
  </a>`;
}
function soonCard(h){
  return `<div class="soon-card h-upcoming" data-card-sphere="${h.sphere}">
    <div class="row"><p class="eyebrow">${h.sphere}</p><span class="tag">скоро</span></div>
    <h4>${h.name}</h4><p>${h.years}</p><p>${h.teaser}</p></div>`;
}
function heroChip(id){
  const h = byId(id); if(!h) return "";
  return HEROES.includes(h) ? `<a class="h-${id}" href="#${id}">${h.short}</a>` : `<span>${h.short}, скоро</span>`;
}
function linkCard(l){
  return `<div class="link-card"><span class="yr">${l.year}</span><h4>${l.title}</h4><p>${l.text}</p>
    <div class="pair">${heroChip(l.a)}${heroChip(l.b)}${l.c?heroChip(l.c):""}</div></div>`;
}
function timelineSVG(){
  const rows = [...ALL].sort((a,b)=>a.vienna[0][0]-b.vienna[0][0]);
  const X0 = 150, X1 = 885, Y1 = 1775, Y2 = 1950, TOP = 34, RH = 30;
  const x = y=>X0+(y-Y1)/(Y2-Y1)*(X1-X0);
  const yOf = id=>TOP+rows.findIndex(r=>r.id===id)*RH+RH/2;
  const H = TOP+rows.length*RH+10;
  let s = `<svg viewBox="0 0 900 ${H}" role="img" aria-label="Годы жизни героев в Вене, 1775–1950">`;
  for(let y=Y1;y<=Y2;y+=25) s += `<line class="tl-tick" x1="${x(y)}" y1="${TOP-8}" x2="${x(y)}" y2="${H-6}"/><text class="tl-year" x="${x(y)}" y="${TOP-14}" text-anchor="middle">${y}</text>`;
  LINKS.forEach(l=>{
    const yr = +l.year, ys = [l.a,l.b,l.c].filter(Boolean).filter(id=>rows.some(r=>r.id===id)).map(yOf);
    s += `<line class="tl-conn" x1="${x(yr)}" x2="${x(yr)}" y1="${Math.min(...ys)}" y2="${Math.max(...ys)}"><title>${l.year}: ${l.title}</title></line>`;
    ys.forEach(yy=>{ s += `<circle class="tl-dot" cx="${x(yr)}" cy="${yy}" r="3.5"><title>${l.year}: ${l.title}</title></circle>`; });
  });
  rows.forEach((r,i)=>{
    const cy = TOP+i*RH+RH/2; const active = HEROES.includes(r);
    const label = `<text class="tl-name${active?"":" up"}" x="0" y="${cy}" dominant-baseline="central">${r.short}${active?"":" · скоро"}</text>`;
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
    <div class="check thin" aria-hidden="true" style="width:120px"></div>
    <p>Пилотная версия ${APP_VERSION}. Монологи героев написаны как художественная реконструкция по письмам и воспоминаниям; под каждым указано, на что он опирается. Исторические справки основаны на биографиях и материалах венских музеев. Карта схематична: расстояния и направления в масштабе, улицы не показаны.</p>
    <p>Отметки о пройденных местах и настройки хранятся только на этом телефоне.</p>
  </footer>`;
}

/* ============================ hero page ============================ */
function renderHero(h, keepScroll){
  const y = window.scrollY;
  S.hero = h; S.active = -1;
  const stops = stopsOf(h);
  const st = dayStats(h); const L = legs(stops);
  const others = LINKS.filter(l=>[l.a,l.b,l.c].includes(h.id));
  const nextHero = HEROES[(HEROES.indexOf(h)+1)%HEROES.length];
  $("#app").innerHTML = `
  <div class="h-${h.id}">
  <div class="wrap">
    <a class="back" href="#heroes">← Все герои</a>
    <section class="hh">
      <div class="mono-big">${monogram(h,112)}</div>
      <div>
        <p class="eyebrow">${h.sphere} · ${h.years} · ${h.inVienna}</p>
        <h1>${h.name}</h1>
        <p class="hh-day"><span class="date">${h.date}</span><span>${h.dayTitle}</span></p>
        <p class="lede">${h.lede}</p>
        <ul class="stats">
          <li><b>${st.places}</b><span>${plural(st.places,"место","места","мест")}</span></li>
          <li><b>${km(st.walkM)} км</b><span>пешком</span></li>
          ${st.transit?`<li><b>${st.transit}</b><span>${plural(st.transit,"поездка","поездки","поездок")}</span></li>`:""}
          <li><b>≈ ${fmtMin(st.minutes)}</b><span>прогулка</span></li>
          <li><b>${stops[0].time}–${stops[stops.length-1].time}</b><span>день героя</span></li>
        </ul>
        <div class="actions">
          <button class="btn solid" type="button" id="walk-start">${ICON.walk}Начать прогулку</button>
          <button class="btn" type="button" id="play-day" ${Voice.ok?"":"disabled"}>${ICON.play}Слушать весь день</button>
          <button class="btn" type="button" id="walk-demo">${ICON.demo}Демо-прогулка</button>
          <a class="btn" href="${mapsRoute(stops)}" target="_blank" rel="noopener">${ICON.out}Маршрут в Google Картах</a>
        </div>
        <p class="note"><b>Старт:</b> ${h.start}</p>
        <p class="note">Во время прогулки держите экран включённым: приложение следит за геопозицией и само включает голос у каждой точки. Демо-прогулка проходит маршрут виртуально, чтобы попробовать дома.</p>
        <p class="note" id="voice-note">${Voice.note()}</p>
      </div>
    </section>
  </div>
  <div class="check thin" aria-hidden="true" style="background-image:repeating-conic-gradient(var(--hc) 0 25%,transparent 0 50%)"></div>
  <div class="wrap">
    <section class="day">
      <aside class="mapcard" aria-label="Схема маршрута">
        <div id="map">${mapSVG(h, stops)}</div>
        <div class="map-foot">
          <div class="progress"><span class="bar"><i id="prog-bar"></i></span><span id="prog-txt"></span></div>
          <span class="legend"><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--hc)" stroke-width="2.5"/></svg> пешком
          ${st.transit?`<svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--hc)" stroke-width="3" stroke-dasharray="2 5" stroke-linecap="round"/></svg> транспорт`:""}
          <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--me)" stroke="var(--surface)" stroke-width="2"/></svg> вы</span>
        </div>
        <p class="mapnote">Схема: прямые линии показывают направление, а не улицы; пунктирный круг показывает зону, где включается голос. Нажмите на точку, чтобы открыть место.</p>
      </aside>
      <div class="stops">
        ${stops.map((s,i)=>stopHTML(h,s,i,L[i])).join("")}
        <div class="epilogue"><p class="eyebrow">После этого дня</p><p>${h.epilogue}</p></div>
      </div>
    </section>
    ${others.length?`<section class="hero-links">
      <div class="section-head"><h2>Связи</h2><p>Где день ${h.gen} пересекается с другими героями.</p></div>
      <div class="links n${others.length}" style="margin-top:0">${others.map(linkCard).join("")}</div>
    </section>`:""}
    <div class="next-hero">
      <span class="eyebrow">Следующий день</span>
      <a class="btn h-${nextHero.id}" href="#${nextHero.id}">${nextHero.short}: ${nextHero.dayTitle} →</a>
    </div>
    ${footer()}
  </div>
  </div>`;
  wireHero(h);
  refreshMarks(); markTarget(); updateVoiceUI();
  if(S.walk && S.walk.pos) updateMe(S.walk.pos);
  if(keepScroll) window.scrollTo({top:y, behavior:"instant"});
}

function stopHTML(h, s, i, leg){
  const v = isVisited(h.id, i);
  let legHTML = "";
  if(leg){
    if(leg.same) legHTML = `<div class="leg">${ICON.walk}<span>Возвращение в тот же дом.</span></div>`;
    else if(leg.transit) legHTML = `<div class="leg transit">${ICON.tram}<span>≈ ${km(leg.d)} км по прямой. ${s.go}</span></div>`;
    else legHTML = `<div class="leg">${ICON.walk}<span>≈ ${fmtDist(leg.walk)} · ${Math.max(1, Math.round(leg.walk/75))} мин пешком</span></div>`;
  }
  const calib = settings.calibrate ? `<div class="calib">
      <button class="btn small" type="button" data-calib="${i}">${ICON.pin}Записать мои координаты сюда</button>
      ${s.calibrated?`<span class="cal-ok">уточнено на месте</span>`:s.approx?`<span class="cal-approx">координаты приблизительные</span>`:`<span class="cal-muted">координаты из справочника</span>`}
    </div>` : "";
  return `${legHTML}
  <article class="stop${v?" v":""}" id="stop-${i}" data-i="${i}">
    <div class="stop-time">${s.time}</div>
    <div class="stop-card">
      <div class="stop-head"><span class="num">${i+1}</span>
        <div><h3>${s.title}</h3><p class="place">${s.place} · ${s.addr}</p></div>
      </div>
      <blockquote class="voice">${s.voice}</blockquote>
      <p class="src">${s.src}</p>
      <div class="stop-actions">
        <button class="btn small solid" type="button" data-speak="${i}">${ICON.play}Голос героя</button>
        <button class="btn small" type="button" data-visit="${i}" aria-pressed="${v}">${ICON.check}${v?"Вы были здесь":"Я здесь"}</button>
        <a class="btn small" href="${mapsSearch(s.addr)}" target="_blank" rel="noopener">${ICON.out}На карте</a>
      </div>
      ${calib}
      ${s.moment==="hearing"?momentHTML():""}
      <div class="facts">
        <div><p class="eyebrow">Как было</p><p>${s.fact}</p></div>
        <div class="now"><p class="eyebrow">Сегодня</p><p>${s.now}</p></div>
      </div>
    </div>
  </article>`;
}

function momentHTML(){
  return `<div class="moment">
    <p class="eyebrow">Момент погружения</p>
    <h4>Услышать поле, как слышал его Бетховен</h4>
    <p>Где-то вдали пастух играет на дудочке. Сначала послушайте, как её слышал Рис. Потом переключитесь на слух Бетховена в 1802 году: высокие звуки уходят, остаётся гул и шум в ушах, о которых он писал Вегелеру. Лучше в наушниках, громкость умеренная.</p>
    <div class="moment-ctl">
      <button class="btn small solid" type="button" id="hear-play">${ICON.play}Слушать поле</button>
      <div class="seg" role="group" aria-label="Чей слух">
        <button type="button" data-mode="ries" aria-pressed="${Hear.mode!=="lvb"}">Слух Риса</button>
        <button type="button" data-mode="lvb" aria-pressed="${Hear.mode==="lvb"}">Слух Бетховена, 1802</button>
      </div>
    </div>
    <canvas id="hear-spec" style="color:var(--hc)" aria-label="Спектр звука: слева низкие частоты, справа высокие"></canvas>
    <div class="spec-legend"><span>низкие частоты</span><span>высокие частоты · до 9 кГц</span></div>
  </div>`;
}
function stopHearing(){ Hear.stop($("#hear-spec")); const b = $("#hear-play"); if(b) b.innerHTML = ICON.play+"Слушать поле"; }

function wireHero(h){
  $("#walk-start").addEventListener("click", ()=>startWalk(false));
  $("#walk-demo").addEventListener("click", ()=>startWalk(true));
  $("#play-day").addEventListener("click", ()=>{
    if(S.listen && Voice.playing){ stopListen(); return; }
    if(S.walk) endWalk(true);
    Voice.broken = false; listen(h, 0, true);
  });
  $$("[data-speak]").forEach(b=>b.addEventListener("click", e=>{
    e.stopPropagation(); const i = +b.dataset.speak;
    const P = Voice.playing;
    if(P && P.hero === h && P.key === i){ Voice.stop(); S.listen = false; return; }
    Voice.broken = false;
    if(S.walk){ const s = S.walk.stops[i]; Voice.say(h, i, s.title, s.voice, s.audio||null, null); }
    else listen(h, i, false);
  }));
  $$("[data-visit]").forEach(b=>b.addEventListener("click", e=>{
    e.stopPropagation(); const i = +b.dataset.visit;
    setVisited(h.id, i, !isVisited(h.id, i)); syncVisitUI(i);
    if(S.walk){ isVisited(h.id,i) ? S.walk.done.add(i) : S.walk.done.delete(i); S.walk.target = nextTarget(); markTarget(); renderDock(); }
  }));
  $$("[data-calib]").forEach(b=>b.addEventListener("click", e=>{ e.stopPropagation(); calibrate(h, +b.dataset.calib); }));
  $$(".stop").forEach(el=>el.addEventListener("click", e=>{ if(e.target.closest("a,button")) return; setActive(+el.dataset.i, false); }));
  $$("#map .mk").forEach(g=>{
    const go = ()=>setActive(+g.dataset.i.split(",")[0], true);
    g.addEventListener("click", go);
    g.addEventListener("keydown", e=>{ if(e.key==="Enter" || e.key===" "){ e.preventDefault(); go(); } });
  });
  const hp = $("#hear-play");
  if(hp){
    hp.addEventListener("click", e=>{
      e.stopPropagation();
      if(Hear.on){ stopHearing(); return; }
      if(Hear.start($("#hear-spec"))) hp.innerHTML = ICON.stop+"Остановить";
      else hp.textContent = "Звук недоступен в этом браузере";
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
  const b = $(`[data-visit="${i}"]`); if(b){ b.setAttribute("aria-pressed", String(v)); b.innerHTML = ICON.check+(v?"Вы были здесь":"Я здесь"); }
  refreshMarks();
}

function setActive(i, scroll){
  S.active = i;
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
  const n = (visited[S.hero.id]||[]).length, t = S.hero.stops.length;
  const bar = $("#prog-bar"), txt = $("#prog-txt");
  if(bar) bar.style.width = (n/t*100)+"%";
  if(txt) txt.textContent = `пройдено ${n} из ${t}`;
}

/* ============================ калибровка координат ============================ */
async function calibrate(h, i){
  let pos = S.lastPos && Date.now()-S.lastPos.ts < 20000 && !S.lastPos.demo ? S.lastPos : null;
  if(!pos){
    toast("Определяем координаты…", null, null, 0);
    try{ pos = await Geo.once(); S.lastPos = pos; }
    catch(e){ toast(geoErrText(e) || "Не удалось определить координаты.", null, null, 7000); return; }
  }
  if(pos.acc > 35){ toast(`Точность ±${Math.round(pos.acc)} м, этого мало. Постойте на открытом месте и попробуйте снова.`, null, null, 6000); return; }
  overrides[h.id] = overrides[h.id] || {};
  overrides[h.id][i] = {lat:+pos.lat.toFixed(6), lng:+pos.lng.toFixed(6), acc:Math.round(pos.acc), title:h.stops[i].title};
  save(K.overrides, overrides);
  if(S.walk && S.walk.hero === h) S.walk.stops = stopsOf(h);
  renderHero(h, true);
  toast(`Точка ${i+1} «${h.stops[i].title}» уточнена (±${Math.round(pos.acc)} м).`);
}

/* ============================ settings ============================ */
function overridesCount(){ return Object.values(overrides).reduce((a,o)=>a+Object.keys(o).length, 0); }
function openSettings(){
  const dlg = $("#settings");
  const nVisited = Object.values(visited).reduce((a,v)=>a+v.length, 0);
  const nOv = overridesCount();
  const sw = "serviceWorker" in navigator && navigator.serviceWorker.controller;
  dlg.innerHTML = `<form method="dialog" class="set">
    <div class="set-head"><h3>Настройки</h3><button class="btn small" value="close" aria-label="Закрыть">Готово</button></div>
    <label class="sw"><input type="checkbox" id="set-autoVoice" ${settings.autoVoice?"checked":""}><span><b>Голос включается сам у точки</b><small>Во время прогулки монолог звучит, как только вы подходите к месту.</small></span></label>
    <label class="sw"><input type="checkbox" id="set-vibrate" ${settings.vibrate?"checked":""}><span><b>Вибрация при прибытии</b><small>Работает на Android; iPhone вибрацию из браузера не поддерживает.</small></span></label>
    <label class="sw"><input type="checkbox" id="set-calibrate" ${settings.calibrate?"checked":""}><span><b>Режим уточнения координат</b><small>Для пилота: встаньте у двери и сохраните точные координаты точки. Правки можно скопировать и отправить разработчику.</small></span></label>
    <div class="set-row"><span>Отмечено мест: <b>${nVisited}</b></span><button class="btn small" type="button" id="set-reset" ${nVisited?"":"disabled"}>Сбросить отметки</button></div>
    <div class="set-row"><span>Уточнённых точек: <b>${nOv}</b></span>
      <span class="set-acts"><button class="btn small" type="button" id="set-copy" ${nOv?"":"disabled"}>Скопировать</button><button class="btn small" type="button" id="set-clear" ${nOv?"":"disabled"}>Удалить</button></span></div>
    <textarea id="set-json" readonly hidden></textarea>
    <p class="set-note">Работа без интернета: ${sw?"<b>готово</b>, приложение сохранено на этом устройстве.":"включится, когда приложение открыто по собственному адресу (https)."}<br>Версия ${APP_VERSION}.</p>
  </form>`;
  const bind = (id, key)=>$("#"+id, dlg).addEventListener("change", e=>{
    settings[key] = e.target.checked; save(K.settings, settings);
    if(key === "calibrate" && S.hero) renderHero(S.hero, true);
  });
  bind("set-autoVoice","autoVoice"); bind("set-vibrate","vibrate"); bind("set-calibrate","calibrate");
  $("#set-reset", dlg).addEventListener("click", ()=>{
    visited = {}; save(K.visited, visited);
    if(S.walk){ S.walk.done.clear(); S.walk.target = nextTarget(); }
    if(S.hero) renderHero(S.hero, true); else renderHome();
    openSettings(); toast("Отметки сброшены.");
  });
  $("#set-copy", dlg).addEventListener("click", ()=>{
    const json = JSON.stringify(overrides, null, 2);
    const ta = $("#set-json", dlg); ta.value = json;
    const fallback = ()=>{ ta.hidden = false; ta.focus(); ta.select(); toast("Выделите текст и скопируйте его вручную."); };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(()=>toast("Уточнения скопированы. Пришлите их разработчику."), fallback);
    else fallback();
  });
  $("#set-clear", dlg).addEventListener("click", ()=>{
    overrides = {}; save(K.overrides, overrides);
    if(S.walk) S.walk.stops = stopsOf(S.walk.hero);
    if(S.hero) renderHero(S.hero, true);
    openSettings(); toast("Уточнённые координаты удалены.");
  });
  if(!dlg.open){ if(dlg.showModal) dlg.showModal(); else dlg.setAttribute("open",""); }
}
$("#open-settings").addEventListener("click", openSettings);

/* ============================ install & service worker ============================ */
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); S.installEvt = e; refreshInstall(); });
window.addEventListener("appinstalled", ()=>{ S.installEvt = null; refreshInstall(); toast("Приложение установлено."); });
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
        if(navigator.serviceWorker.controller) toast("Доступна новая версия приложения.", "Обновить", ()=>{ updating = true; nw.postMessage("skipWaiting"); }, 0);
        else toast("Готово: приложение будет работать без интернета.");
      });
    });
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener("controllerchange", ()=>{ if(updating) location.reload(); });
}

function netStatus(){ const n = $("#net"); if(n) n.hidden = navigator.onLine !== false; }
window.addEventListener("online", netStatus); window.addEventListener("offline", netStatus); netStatus();

/* ============================ router ============================ */
function route(){
  const h = (location.hash||"").slice(1);
  const hero = HEROES.find(x=>x.id===h);
  if(Hear.on) Hear.stop();
  if(S.walk && (!hero || hero !== S.walk.hero)){ endWalk(true); toast("Прогулка остановлена."); }
  if(!S.walk){ S.listen = false; Voice.stop(); }
  if(hero){ renderHero(hero); window.scrollTo({top:0, behavior:"instant"}); }
  else {
    if(!$("#heroes")) renderHome();
    if(h && h !== "top"){ const el = document.getElementById(h); if(el) el.scrollIntoView(); }
    else window.scrollTo({top:0, behavior:"instant"});
  }
  renderDock();
}
window.addEventListener("hashchange", route);
route();
