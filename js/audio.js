// Голос героя: готовые записи (нейросетевые голоса, позже актёры) или синтез речи телефона,
// и звуковой «момент погружения».

const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

// Предложения склеиваем в куски до ~220 знаков: так интонация не рвётся на каждой точке,
// а сетевые голоса Chrome не обрываются на длинном тексте.
function chunks(t, max){
  const sent = (t.match(/[^.!?…]+[.!?…]+[»"”]*|[^.!?…]+$/g) || [t]).map(s=>s.trim()).filter(Boolean);
  const out = []; let cur = "";
  for(const s of sent){
    if(cur && (cur+" "+s).length > max){ out.push(cur); cur = s; }
    else cur = cur ? cur+" "+s : s;
  }
  if(cur) out.push(cur);
  return out;
}

// Оценка качества голоса синтезатора по названию
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|hysterical|eddy|flo\b|grandma|grandpa|reed|rocko|sandy|shelley/i;
export function voiceScore(v){
  let s = 0;
  if(/natural/i.test(v.name)) s += 100;       // нейросетевые голоса Microsoft Edge
  if(/premium/i.test(v.name)) s += 80;        // Apple: скачиваемые «премиум»
  if(/enhanced|neural|wavenet/i.test(v.name)) s += 60;
  if(/google/i.test(v.name)) s += 40;
  if(/compact/i.test(v.name)) s -= 30;
  if(NOVELTY.test(v.name)) s -= 200;
  return s;
}

export const Voice = {
  ok: hasTTS,
  voice: null,
  hasLang: false,
  goodVoice: false,     // есть ли на устройстве качественный голос для языка
  langTag: "ru-RU",
  chosen: {},           // выбор пользователя: {язык: voiceURI}
  broken: false,        // синтез молчит (нет голосов, заблокирован): показываем текст и отсчитываем время чтения
  playing: null,        // {hero, key, title, simulated, recorded}
  token: null,
  timers: [],
  el: null,             // один постоянный аудиоэлемент: на iPhone он «разблокируется» первым нажатием
  listeners: new Set(),

  init(tag, chosen){
    if(tag) this.langTag = tag;
    if(chosen) this.chosen = chosen;
    if(!hasTTS) return;
    const load = ()=>{ this._pick(); this.emit(); };
    this._pick();
    try{ speechSynthesis.addEventListener("voiceschanged", load); }catch(e){ speechSynthesis.onvoiceschanged = load; }
  },

  setLang(tag){ this.langTag = tag; this.broken = false; this._pick(); },
  choose(uri){ const l = this.langTag.slice(0,2); if(uri) this.chosen[l] = uri; else delete this.chosen[l]; this._pick(); },

  // Голоса текущего языка, лучшие первыми
  voices(){
    if(!hasTTS) return [];
    let vs = [];
    try{ vs = speechSynthesis.getVoices() || []; }catch(e){}
    const norm = v=>String(v.lang||"").toLowerCase().replace("_","-");
    const tag = this.langTag.toLowerCase(), pre = tag.slice(0,2);
    return vs.filter(v=>norm(v).split("-")[0] === pre)
      .map(v=>({v, s: voiceScore(v) + (norm(v) === tag ? 5 : 0)}))
      .sort((a,b)=>b.s-a.s).map(x=>x.v);
  },
  _pick(){
    if(!hasTTS) return;
    const list = this.voices();
    this.hasLang = list.length > 0;
    const want = this.chosen[this.langTag.slice(0,2)];
    this.voice = (want && list.find(v=>v.voiceURI === want)) || list.find(v=>voiceScore(v) >= 0) || list[0] || null;
    this.goodVoice = !!this.voice && voiceScore(this.voice) >= 40;
  },

  on(fn){ this.listeners.add(fn); },
  emit(){ this.listeners.forEach(fn=>{ try{ fn(this.playing); }catch(e){} }); },

  _audio(){
    if(!this.el){ this.el = new Audio(); this.el.preload = "auto"; }
    return this.el;
  },

  // Вызывать из обработчика нажатия: iOS разрешает звук и речь только после жеста пользователя.
  unlock(text, hero, introUrl, silenceUrl){
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC){ this._ac = this._ac || new AC(); if(this._ac.state === "suspended") this._ac.resume(); }
    }catch(e){}
    if(introUrl){ this.say(hero, "intro", "", text || "", introUrl, null); return; }
    if(silenceUrl){ try{ const a = this._audio(); a.src = silenceUrl; a.play().catch(()=>{}); }catch(e){} }
    if(text) this.say(hero, "intro", "", text, null, null);
  },

  stop(){
    this.token = null;
    this.timers.forEach(clearTimeout); this.timers = [];
    if(this.el){ try{ this.el.onended = null; this.el.onerror = null; this.el.pause(); }catch(e){} }
    if(hasTTS){ try{ speechSynthesis.cancel(); }catch(e){} }
    if(this.playing){ this.playing = null; this.emit(); }
  },

  // key: номер остановки, "intro" или "epilogue"
  say(hero, key, title, text, audioUrl, onEnd){
    this.stop();
    const token = {}; this.token = token;
    this.playing = {hero, key, title, simulated:false, recorded:!!audioUrl};
    this.emit();
    const done = ()=>{
      if(this.token !== token) return;
      this.token = null; this.playing = null; this.emit();
      onEnd && onEnd();
    };
    if(audioUrl){
      const a = this._audio();
      const fallback = ()=>{ if(this.token !== token) return; a.onended = a.onerror = null; this.playing.recorded = false; this._tts(hero, text, token, done); };
      a.onended = done; a.onerror = fallback;
      try{ a.src = audioUrl; a.currentTime = 0; }catch(e){}
      const p = a.play(); if(p && p.catch) p.catch(fallback);
      return;
    }
    this._tts(hero, text, token, done);
  },

  _simulate(text, token, done){
    if(this.playing){ this.playing.simulated = true; this.emit(); }
    const ms = Math.min(30000, Math.max(3000, text.length/16*1000));
    this.timers.push(setTimeout(()=>{ if(this.token === token) done(); }, ms));
  },

  _tts(hero, text, token, done){
    if(!text){ done(); return; }
    if(!hasTTS || this.broken){ this._simulate(text, token, done); return; }
    // Локальные голоса читают текст целиком — так интонация естественнее; сетевым даём куски
    const parts = this.voice && this.voice.localService ? chunks(text, 1200) : chunks(text, 220);
    let i = 0, started = false;
    const next = ()=>{
      if(this.token !== token) return;
      if(i >= parts.length){ done(); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = this.voice ? this.voice.lang : this.langTag; if(this.voice) u.voice = this.voice;
      // Высоту голоса не трогаем: сдвиг высоты делает синтезатор металлическим
      u.rate = 0.97; u.pitch = 1;
      u.onstart = ()=>{ started = true; };
      u.onend = next;
      u.onerror = e=>{
        if(this.token !== token) return;
        if(e && (e.error === "interrupted" || e.error === "canceled")) return;
        if(!started){ this.broken = true; try{ speechSynthesis.cancel(); }catch(_){} this._simulate(parts.slice(i-1).join(" "), token, done); return; }
        next();
      };
      try{ speechSynthesis.speak(u); }catch(e){ this.broken = true; this._simulate(text, token, done); }
    };
    let busy = false;
    try{ busy = speechSynthesis.speaking || speechSynthesis.pending; }catch(e){}
    if(busy) this.timers.push(setTimeout(next, 80)); else next();
    // Если синтез за 3 секунды так и не заговорил, считаем его недоступным.
    this.timers.push(setTimeout(()=>{
      if(this.token === token && !started){
        this.broken = true; try{ speechSynthesis.cancel(); }catch(e){}
        this._simulate(text, token, done);
      }
    }, 3000));
  },

  // Короткий пример выбранного голоса для настроек
  sample(text){
    if(!hasTTS) return;
    this.stop();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.voice ? this.voice.lang : this.langTag; if(this.voice) u.voice = this.voice;
    try{ speechSynthesis.speak(u); }catch(e){}
  }
};

/* ---------- Момент погружения: слух Бетховена ---------- */

const TUNE = [[81,.5],[86,.5],[88,.75],[90,.25],[88,.5],[86,.5],[83,1],[81,1.5],[null,.5],[81,.5],[83,.5],[86,.5],[88,.5],[86,.25],[83,.25],[81,.5],[78,.5],[81,2]];
const mtof = m => 440*Math.pow(2,(m-69)/12);

export const Hear = {
  ac:null, n:null, timer:null, raf:0, next:0, mode:"ries",

  _noise(ac){ const b = ac.createBuffer(1, ac.sampleRate*2, ac.sampleRate); const d = b.getChannelData(0); for(let i=0;i<d.length;i++) d[i] = Math.random()*2-1; return b; },

  _phrase(t0){
    const {ac, mel} = this.n; const beat = .42; let t = t0;
    for(const [m,d] of TUNE){
      const dur = d*beat;
      if(m != null){
        const f = mtof(m);
        const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = f;
        const o2 = ac.createOscillator(); o2.type = "sine"; o2.frequency.value = f*2;
        const vib = ac.createOscillator(); vib.frequency.value = 5.3; const vg = ac.createGain(); vg.gain.value = f*.006;
        vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
        const g = ac.createGain(); const g2 = ac.createGain(); g2.gain.value = .18;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.5, t+.05);
        g.gain.setValueAtTime(.5, t+Math.max(.06, dur-.08)); g.gain.linearRampToValueAtTime(0, t+dur);
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(mel);
        [o,o2,vib].forEach(x=>{ x.start(t); x.stop(t+dur+.05); });
      }
      t += dur;
    }
    return t-t0;
  },

  start(canvas){
    try{
      const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return false;
      this.ac = this.ac || new AC(); const ac = this.ac; if(ac.state === "suspended") ac.resume();
      const out = ac.createGain(); out.gain.value = .8;
      const an = ac.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = .8;
      out.connect(an); an.connect(ac.destination);
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 12000; lp.Q.value = .7; lp.connect(out);
      const mel = ac.createGain(); mel.gain.value = .35; mel.connect(lp);
      const dl = ac.createDelay(); dl.delayTime.value = .28; const fb = ac.createGain(); fb.gain.value = .3;
      mel.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(lp);
      const nb = this._noise(ac);
      const wind = ac.createBufferSource(); wind.buffer = nb; wind.loop = true;
      const wf = ac.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 500; wf.Q.value = .6;
      const wg = ac.createGain(); wg.gain.value = .05; wind.connect(wf); wf.connect(wg); wg.connect(lp);
      const tin = ac.createGain(); tin.gain.value = 0; tin.connect(out);
      const roar = ac.createBufferSource(); roar.buffer = nb; roar.loop = true; roar.loopStart = .5;
      const rf = ac.createBiquadFilter(); rf.type = "bandpass"; rf.frequency.value = 2400; rf.Q.value = 3;
      const rg = ac.createGain(); rg.gain.value = .16; roar.connect(rf); rf.connect(rg); rg.connect(tin);
      const hum = ac.createBufferSource(); hum.buffer = nb; hum.loop = true; hum.loopStart = 1;
      const hf = ac.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 170;
      const hg = ac.createGain(); hg.gain.value = .55; hum.connect(hf); hf.connect(hg); hg.connect(tin);
      const wh = ac.createOscillator(); wh.frequency.value = 3900; const whg = ac.createGain(); whg.gain.value = .006; wh.connect(whg); whg.connect(tin);
      const lfo = ac.createOscillator(); lfo.frequency.value = .18; const lg = ac.createGain(); lg.gain.value = .08; lfo.connect(lg); lg.connect(rg.gain);
      [wind,roar,hum,wh,lfo].forEach(x=>x.start());
      this.n = {ac,out,an,lp,mel,tin,src:[wind,roar,hum,wh,lfo]};
      this.next = ac.currentTime + .25;
      this.timer = setInterval(()=>{ if(this.n && this.next-ac.currentTime < .6){ const len = this._phrase(this.next); this.next += len+1.8; } }, 150);
      this.setMode(this.mode, true);
      this._draw(canvas);
      return true;
    }catch(e){ return false; }
  },

  setMode(mode, instant){
    this.mode = mode;
    if(!this.n) return;
    const {ac, lp, mel, tin} = this.n; const t = ac.currentTime; const k = instant ? .01 : .35;
    const deaf = mode === "lvb";
    lp.frequency.setTargetAtTime(deaf ? 260 : 12000, t, k);
    mel.gain.setTargetAtTime(deaf ? .14 : .35, t, k);
    tin.gain.setTargetAtTime(deaf ? 1 : 0, t, k);
  },

  stop(canvas){
    clearInterval(this.timer); this.timer = null; cancelAnimationFrame(this.raf);
    if(this.n){ this.n.src.forEach(s=>{ try{ s.stop(); }catch(e){} }); try{ this.n.out.disconnect(); }catch(e){} this.n = null; }
    if(canvas){ const x = canvas.getContext("2d"); x.clearRect(0,0,canvas.width,canvas.height); }
  },

  get on(){ return !!this.n; },

  _draw(c){
    if(!c || !this.n) return;
    const dpr = window.devicePixelRatio || 1; const w = c.clientWidth, h = c.clientHeight;
    c.width = Math.round(w*dpr); c.height = Math.round(h*dpr);
    const x = c.getContext("2d"); const an = this.n.an; const data = new Uint8Array(an.frequencyBinCount);
    const col = getComputedStyle(c).color; const bins = 96;
    const loop = ()=>{
      if(!this.n) return;
      an.getByteFrequencyData(data);
      x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,w,h);
      const bw = w/bins; x.fillStyle = col;
      for(let i=0;i<bins;i++){ const v = data[i]/255; const bh = Math.max(1, v*(h-4)); x.fillRect(i*bw+1, h-bh, Math.max(1,bw-2), bh); }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
};
