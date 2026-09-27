import en from '../../js/content/en.js';
import { UI } from '../../js/i18n.js';
import fs from 'fs';
const out = {};
for(const [id,h] of Object.entries(en.heroes)){
  out[id] = { stops: h.stops.map(s=>s.voice), epilogue: h.epilogue,
    intro: UI.en.introFirst.replace('{short}', h.short).replace('{title}', h.stops[0].title) };
}
fs.writeFileSync('en-texts.json', JSON.stringify(out, null, 1));
console.log(Object.entries(out).map(([k,v])=>k+': '+v.stops.length+' stops, '+(v.stops.join('').length+v.epilogue.length+v.intro.length)+' chars').join('\n'));
