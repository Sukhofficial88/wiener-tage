// Голос героя (записи актёров или синтез речи) и звуковой «момент погружения».

const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

function splitSentences(t){
  return (t.match(/[^.!?…]+[.!?…]+[»"]*|[^.!?…]+$/g) || [t]).map(s=>s.trim()).filter(Boolean);
}

export const Voice = {
  ok: hasTTS,
  voice: null,
  hasRu: false,
  broken: false,        // синтез молчит (нет голосов, заблокирован): показываем текст и отсчитываем время чтения
  playing: null,        // {hero, key, title}
  token: null,
  timers: [],
  audioEl: null,
  listeners: new Set(),

  init(){
    if(!hasTTS) return;
    const load = ()=>{
      let vs = [];
      try{ vs = speechSynthesis.getVoices() || []; }catch(e){}
      const ru = vs.filter(v=>/^ru([-_]|$)/i.test(v.lang||""));
      this.hasRu = ru.length > 0;
      this.voice = ru.find(v=>/google|premium|enhanced|natural|neural|milena|yuri/i.test(v.name)) || ru[0] || null;
      this.emit();
    };
    load();
    try{ speechSynthesis.addEventListener("voiceschanged", load); }catch(e){ speechSynthesis.onvoiceschanged = load; }
  },

  on(fn){ this.listeners.add(fn); },
  emit(){ this.listeners.forEach(fn=>{ try{ fn(this.playing); }catch(e){} }); },

  note(){
    if(!hasTTS) return "Этот браузер не умеет синтезировать речь, поэтому монологи показаны текстом. В следующей версии их прочтут актёры.";
    return "Голос пока синтезирует телефон"+(this.hasRu?"":" (русского голоса в системе не нашлось, будет использован голос по умолчанию)")+". В следующей версии монологи прочтут актёры.";
  },

  // Вызывать из обработчика нажатия: iOS разрешает речь и звук только после жеста пользователя.
  unlock(text, hero){
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC){ this._ac = this._ac || new AC(); if(this._ac.state === "suspended") this._ac.resume(); }
    }catch(e){}
    if(text) this.say(hero, "intro", "", text, null, null);
  },

  stop(){
    this.token = null;
    this.timers.forEach(clearTimeout); this.timers = [];
    if(this.audioEl){ try{ this.audioEl.pause(); }catch(e){} this.audioEl = null; }
    if(hasTTS){ try{ speechSynthesis.cancel(); }catch(e){} }
    if(this.playing){ this.playing = null; this.emit(); }
  },

  // key: номер остановки, "intro" или "epilogue"
  say(hero, key, title, text, audioUrl, onEnd){
    this.stop();
    const token = {}; this.token = token;
    this.playing = {hero, key, title, simulated:false};
    this.emit();
    const done = ()=>{
      if(this.token !== token) return;
      this.token = null; this.playing = null; this.emit();
      onEnd && onEnd();
    };

    if(audioUrl){
      const a = new Audio(audioUrl); this.audioEl = a;
      a.onended = done;
      a.onerror = ()=>{ if(this.token === token){ this.audioEl = null; this._tts(hero, text, token, done); } };
      a.play().catch(()=>{ if(this.token === token){ this.audioEl = null; this._tts(hero, text, token, done); } });
      return;
    }
    this._tts(hero, text, token, done);
  },

  _simulate(text, token, done){
    if(this.playing) { this.playing.simulated = true; this.emit(); }
    const ms = Math.min(30000, Math.max(3000, text.length/16*1000));
    this.timers.push(setTimeout(()=>{ if(this.token === token) done(); }, ms));
  },

  _tts(hero, text, token, done){
    if(!hasTTS || this.broken){ this._simulate(text, token, done); return; }
    const parts = splitSentences(text);
    let i = 0, started = false;
    const next = ()=>{
      if(this.token !== token) return;
      if(i >= parts.length){ done(); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = "ru-RU"; if(this.voice) u.voice = this.voice;
      u.rate = hero ? hero.voice.rate : 1; u.pitch = hero ? hero.voice.pitch : 1;
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
