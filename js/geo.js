// Геопозиция: реальный GPS и демо-прогулка по маршруту.

export function dist(a, b){
  const R = 6371000, r = Math.PI/180;
  const dLat = (b.lat-a.lat)*r, dLng = (b.lng-a.lng)*r;
  const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

function lerp(a, b, t){ return {lat:a.lat+(b.lat-a.lat)*t, lng:a.lng+(b.lng-a.lng)*t}; }

const toPos = p => ({lat:p.coords.latitude, lng:p.coords.longitude, acc:p.coords.accuracy, ts:p.timestamp||Date.now()});

export const Geo = {
  supported: typeof navigator !== "undefined" && "geolocation" in navigator,
  watchId: null,
  demoTimer: null,

  start(onPos, onErr){
    if(!this.supported){ onErr({code:0}); return; }
    this.watchId = navigator.geolocation.watchPosition(
      p => onPos(toPos(p)),
      e => onErr(e),
      {enableHighAccuracy:true, maximumAge:4000, timeout:25000}
    );
  },

  once(){
    return new Promise((res, rej)=>{
      if(!this.supported){ rej({code:0}); return; }
      navigator.geolocation.getCurrentPosition(p=>res(toPos(p)), rej, {enableHighAccuracy:true, maximumAge:0, timeout:25000});
    });
  },

  // Демо: идём по прямым между точками маршрута. isPaused() останавливает движение,
  // пока звучит голос героя. На отрезках с транспортом «едем» в пять раз быстрее.
  demo(stops, onPos, isPaused, onDone){
    this.stopDemo();
    const first = stops[0];
    const path = [{lat:first.lat-0.0011, lng:first.lng-0.0013, fast:false}];
    stops.forEach(s => path.push({lat:s.lat, lng:s.lng, fast:!!s.go}));
    let seg = 0, along = 0;
    const WALK = 9, TICK = 200; // метров за тик
    onPos({...path[0], acc:8, ts:Date.now(), demo:true});
    this.demoTimer = setInterval(()=>{
      if(isPaused()) return;
      if(seg >= path.length-1){ this.stopDemo(); onDone && onDone(); return; }
      const a = path[seg], b = path[seg+1];
      const len = Math.max(1, dist(a, b));
      along += WALK * (b.fast ? 5 : 1);
      if(along >= len){ seg++; along = 0; onPos({lat:b.lat, lng:b.lng, acc:8, ts:Date.now(), demo:true}); return; }
      const p = lerp(a, b, along/len);
      onPos({...p, acc:8, ts:Date.now(), demo:true});
    }, TICK);
  },

  stopDemo(){ if(this.demoTimer){ clearInterval(this.demoTimer); this.demoTimer = null; } },

  stop(){
    if(this.watchId != null && this.supported){ navigator.geolocation.clearWatch(this.watchId); }
    this.watchId = null;
    this.stopDemo();
  }
};
