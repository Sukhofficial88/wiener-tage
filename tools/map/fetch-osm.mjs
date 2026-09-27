// Downloads raw OpenStreetMap data (Overpass) and walking routes (OSRM) for every hero's area.
// Runs in GitHub Actions (.github/workflows/map-data.yml); output goes to tools/map/raw/.
// Map data © OpenStreetMap contributors, ODbL.
import { writeFileSync, mkdirSync } from "node:fs";
import { HEROES } from "../../js/data.js";

const OUT = new URL("./raw/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "wiener-tage map builder (github.com/Sukhofficial88/wiener-tage)" };
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Area per hero: bounding box of the stops plus a margin, so the Ring, the canal and the parks around are visible.
const PAD = { mozart: [0.007, 0.011], freud: [0.008, 0.012], beethoven: [0.006, 0.012], klimt: [0.005, 0.009] };

async function overpass(q){
  for(let round = 0; round < 3; round++){
    for(const url of OVERPASS){
      try{
        const r = await fetch(url, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
        if(r.ok){ const t = await r.text(); if(t.startsWith("{")) return t; }
        console.log("overpass", url, r.status);
      }catch(e){ console.log("overpass", url, e.message); }
      await sleep(5000);
    }
    await sleep(30000);
  }
  throw new Error("overpass failed");
}

for(const h of HEROES){
  const la = h.stops.map(s => s.lat), ln = h.stops.map(s => s.lng);
  const [pl, pg] = PAD[h.id] || [0.006, 0.01];
  const bb = [Math.min(...la) - pl, Math.min(...ln) - pg, Math.max(...la) + pl, Math.max(...ln) + pg].map(v => +v.toFixed(5));
  const b = bb.join(",");
  const q = `[out:json][timeout:240][maxsize:1073741824];
(
  way["highway"](${b});
  way["area:highway"](${b});
  way["railway"~"^(subway|tram|rail|light_rail|narrow_gauge)$"](${b});
  node["railway"~"^(station|halt|tram_stop)$"](${b});
  node["station"="subway"](${b});
  way["waterway"](${b});
  way["natural"~"^(water|wood|scrub|grassland|heath)$"](${b});
  relation["natural"~"^(water|wood)$"](${b});
  way["water"](${b});
  way["leisure"~"^(park|garden|playground|pitch|nature_reserve)$"](${b});
  relation["leisure"~"^(park|garden)$"](${b});
  way["landuse"~"^(grass|forest|vineyard|cemetery|meadow|allotments|recreation_ground|village_green|orchard|farmland)$"](${b});
  relation["landuse"~"^(forest|vineyard|cemetery|grass|meadow)$"](${b});
  way["place"~"^(square|island)$"](${b});
  way["building"](${b});
  relation["building"](${b});
  way["building:part"]["name"](${b});
);
out geom(${b});`;
  console.log(h.id, "bbox", b);
  const osm = await overpass(q);
  writeFileSync(new URL(`${h.id}-osm.json`, OUT), osm);
  console.log(h.id, "osm", (osm.length / 1e6).toFixed(1), "MB");

  // Walking legs between consecutive stops; legs that end at a transit stop are ridden, not walked.
  const legs = [];
  for(let i = 1; i < h.stops.length; i++){
    const a = h.stops[i - 1], z = h.stops[i];
    if(z.transit || (a.lat === z.lat && a.lng === z.lng)){ legs.push(null); continue; }
    let geo = null;
    for(let k = 0; k < 3 && !geo; k++){
      try{
        const r = await fetch(`${OSRM}${a.lng},${a.lat};${z.lng},${z.lat}?overview=full&geometries=geojson&steps=false`, { headers: UA });
        const d = await r.json();
        if(d.code === "Ok") geo = { coords: d.routes[0].geometry.coordinates, distance: d.routes[0].distance, duration: d.routes[0].duration };
      }catch(e){ console.log("osrm", e.message); }
      await sleep(1500);
    }
    legs.push(geo);
  }
  writeFileSync(new URL(`${h.id}-routes.json`, OUT), JSON.stringify({ bbox: bb, legs }));
  console.log(h.id, "legs", legs.map(l => l ? Math.round(l.distance) + "m" : "-").join(" "));
  await sleep(10000);
}
