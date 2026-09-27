// Downloads raw OpenStreetMap data (Overpass) and walking routes (OSRM) for every hero's area.
// Runs in GitHub Actions (.github/workflows/map-data.yml); output goes to tools/map/raw/.
// Each hero gets three files: <id>-osm.json (streets, water, green, rail), <id>-bldg.json (buildings near the stops)
// and <id>-routes.json (walking legs). A failed download is logged and skipped, so one busy server does not lose the rest.
// Map data © OpenStreetMap contributors, ODbL.
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { HEROES } from "../../js/data.js";

const OUT = new URL("./raw/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const LOG = new URL("log.txt", OUT);
const log = (...a) => { const s = a.join(" "); console.log(s); appendFileSync(LOG, new Date().toISOString().slice(11, 19) + " " + s + "\n"); };
const UA = { "User-Agent": "wiener-tage map builder (github.com/Sukhofficial88/wiener-tage)" };
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const only = process.argv[2];

// Area per hero: bounding box of the stops plus a margin, so the Ring, the canal and the parks around are visible.
const PAD = { mozart: [0.007, 0.011], freud: [0.008, 0.012], beethoven: [0.006, 0.012], klimt: [0.005, 0.009] };

async function overpass(q, what){
  for(let round = 0; round < 2; round++){
    for(const url of OVERPASS){
      const t0 = Date.now();
      try{
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 200000);
        const r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
        const t = await r.text(); clearTimeout(timer);
        const sec = ((Date.now() - t0) / 1000).toFixed(0);
        if(r.ok && t.startsWith("{")){
          const j = JSON.parse(t);
          if(j.remark && /error/i.test(j.remark)) log(what, url, "remark:", j.remark.slice(0, 200), sec + "s");
          else { log(what, "ok", url, j.elements.length, "elements", (t.length / 1e6).toFixed(1) + "MB", sec + "s"); return t; }
        } else log(what, url, "HTTP", r.status, t.slice(0, 160).replace(/\s+/g, " "), sec + "s");
      }catch(e){ log(what, url, "error", e.message, ((Date.now() - t0) / 1000).toFixed(0) + "s"); }
      await sleep(8000);
    }
    await sleep(40000);
  }
  return null;
}
const bboxOf = (pts, pl, pg) => [Math.min(...pts.map(p => p.lat)) - pl, Math.min(...pts.map(p => p.lng)) - pg, Math.max(...pts.map(p => p.lat)) + pl, Math.max(...pts.map(p => p.lng)) + pg].map(v => +v.toFixed(5));

for(const h of HEROES){
  if(only && only !== h.id) continue;
  const [pl, pg] = PAD[h.id] || [0.006, 0.01];
  const bb = bboxOf(h.stops, pl, pg), b = bb.join(",");
  log(h.id, "bbox", b);

  const osmFile = new URL(`${h.id}-osm.json`, OUT);
  if(!existsSync(osmFile)){
    const q = `[out:json][timeout:180];
(
  way["highway"](${b});
  way["area:highway"](${b});
  way["railway"~"^(subway|rail|light_rail|narrow_gauge)$"](${b});
  node["railway"~"^(station|halt)$"](${b});
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
);
out geom(${b});`;
    const osm = await overpass(q, h.id + "/base");
    if(osm) writeFileSync(osmFile, osm);
    await sleep(10000);
  }

  // Buildings only around the stops (about 500 m): the whole Klimt area would be far too heavy.
  const bldgFile = new URL(`${h.id}-bldg.json`, OUT);
  if(!existsSync(bldgFile)){
    const boxes = [];
    for(const s of h.stops){
      const bx = bboxOf([s], 0.0045, 0.0068);
      if(!boxes.some(o => o.join() === bx.join())) boxes.push(bx);
    }
    const q = `[out:json][timeout:180];
(
${boxes.map(bx => `  way["building"](${bx.join(",")});\n  relation["building"](${bx.join(",")});`).join("\n")}
);
out geom;`;
    const bl = await overpass(q, h.id + "/buildings");
    if(bl) writeFileSync(bldgFile, bl);
    await sleep(10000);
  }

  // Walking legs between consecutive stops; legs that end at a transit stop are ridden, not walked.
  const rtFile = new URL(`${h.id}-routes.json`, OUT);
  if(!existsSync(rtFile)){
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
          else log(h.id, "osrm", d.code);
        }catch(e){ log(h.id, "osrm error", e.message); }
        await sleep(1500);
      }
      legs.push(geo);
    }
    writeFileSync(rtFile, JSON.stringify({ bbox: bb, legs }));
    log(h.id, "legs", legs.map(l => l ? Math.round(l.distance) + "m" : "-").join(" "));
  }
}
log("done");
