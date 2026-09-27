// Звуковой фон прогулки: тихие петли (птицы, листва, колокола, копыта, кафе) у каждой точки
// и музыка эпохи в паузе «Осмотритесь». Всё идёт через Web Audio: на iPhone у <audio> нельзя менять громкость,
// а здесь работают и плавные переходы, и приглушение фона, пока говорит герой.

const BED = 0.8, DUCKED = 0.3, UNDER_MUSIC = 0.45;

export const Sound = {
  enabled: true,
  ac: null, master: null, bed: null,
  cache: new Map(),       // url → Promise<AudioBuffer>
  layers: [],             // [{src, gain}]
  music: null,            // {src, gain, name}
  token: null,
  voice: false,
  listeners: new Set(),

  // Вызывать из обработчика нажатия (или передать уже разблокированный AudioContext)
  unlock(ac){
    try{
      const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return false;
      if(!this.ac) this.ac = ac || new AC();
      if(this.ac.state !== "running") this.ac.resume().catch(()=>{});
      if(!this.master){
        this.master = this.ac.createGain(); this.master.gain.value = this.enabled ? 1 : 0; this.master.connect(this.ac.destination);
        this.bed = this.ac.createGain(); this.bed.gain.value = BED; this.bed.connect(this.master);
      }
      // iPhone: звук и при выключенном звонке, как у плеера
      try{ if(navigator.audioSession) navigator.audioSession.type = "playback"; }catch(e){}
      return true;
    }catch(e){ return false; }
  },

  on(fn){ this.listeners.add(fn); },
  emit(){ this.listeners.forEach(fn=>{ try{ fn(); }catch(e){} }); },

  load(url){
    if(!this.cache.has(url)){
      const p = fetch(url).then(r=>{ if(!r.ok) throw new Error(url+" "+r.status); return r.arrayBuffer(); })
        .then(b=>new Promise((res, rej)=>{ const r = this.ac.decodeAudioData(b, res, rej); if(r && r.then) r.then(res, rej); }));
      this.cache.set(url, p); p.catch(()=>this.cache.delete(url));
    }
    return this.cache.get(url);
  },
  // Скачать файлы заранее (в кэш сервис-воркера), не расшифровывая: для прогулки без интернета
  prefetch(urls){ (async()=>{ for(const u of urls){ try{ await fetch(u); }catch(e){ return; } } })(); },

  _ramp(param, value, sec){
    const t = this.ac.currentTime;
    try{ param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(value, t + sec); }catch(e){ param.value = value; }
  },
  _bedLevel(){ return this.voice ? DUCKED : this.music ? UNDER_MUSIC : BED; },

  // Фон точки: snd = {bed:[[имя, громкость], ...], music}
  async enter(snd){
    this.leave(2);
    if(!snd || !snd.bed || !this.ac || !this.master) return;
    const token = this.token = {};
    for(const [name, g] of snd.bed){
      let buf; try{ buf = await this.load(`audio/amb/${name}.mp3`); }catch(e){ continue; }
      if(this.token !== token) return;
      const src = this.ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = this.ac.createGain(); gain.gain.value = 0;
      src.connect(gain); gain.connect(this.bed);
      src.start(0, Math.random()*buf.duration);      // слои не совпадают по фазе
      this._ramp(gain.gain, g, 3);
      this.layers.push({src, gain});
    }
  },
  leave(fade = 3){
    this.token = null;
    if(!this.ac) return;
    const t = this.ac.currentTime;
    for(const l of this.layers){ this._ramp(l.gain.gain, 0, fade); try{ l.src.stop(t + fade + 0.05); }catch(e){} }
    this.layers = [];
  },

  // Пока звучит голос, фон тише
  duck(voice){
    this.voice = !!voice;
    if(this.bed) this._ramp(this.bed.gain, this._bedLevel(), voice ? 0.6 : 1.5);
  },

  async playMusic(name, onEnd){
    this.stopMusic(0.5);
    if(!this.ac || !this.master) return false;
    let buf; try{ buf = await this.load(`audio/music/${name}.mp3`); }catch(e){ return false; }
    const src = this.ac.createBufferSource(); src.buffer = buf;
    const gain = this.ac.createGain(); gain.gain.value = 0;
    src.connect(gain); gain.connect(this.master);
    const m = {src, gain, name}; this.music = m;
    src.onended = ()=>{ if(this.music === m){ this.music = null; this.duck(this.voice); this.emit(); onEnd && onEnd(); } };
    src.start();
    this._ramp(gain.gain, 0.9, 1.2);
    this.duck(this.voice); this.emit();
    return true;
  },
  stopMusic(fade = 2){
    const m = this.music; if(!m) return;
    this.music = null;
    if(this.ac){ this._ramp(m.gain.gain, 0, fade); try{ m.src.stop(this.ac.currentTime + fade + 0.05); }catch(e){} }
    this.duck(this.voice); this.emit();
  },
  stopAll(fade = 1.5){ this.stopMusic(fade); this.leave(fade); },

  setEnabled(on){
    this.enabled = !!on;
    if(this.master) this._ramp(this.master.gain, this.enabled ? 1 : 0, 0.8);
    if(!this.enabled) this.stopMusic(0.8);
  }
};
