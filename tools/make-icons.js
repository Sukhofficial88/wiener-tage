// Генерирует PNG-иконки из SVG: node tools/make-icons.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const art = (scale) => {
  const dots = [];
  for (let y = 100; y <= 310; y += 20) for (let x = 140; x <= 372; x += 22) dots.push(`<circle cx="${x + ((y/20)%2 ? 11 : 0)}" cy="${y}" r="6.5"/>`);
  const checks = [];
  for (let i = 0; i < 28; i++) { const x = 116 + i*10; checks.push(`<rect x="${x}" y="${i%2?412:422}" width="10" height="10"/>`); }
  return `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <defs><clipPath id="dome"><circle cx="256" cy="205" r="102"/></clipPath></defs>
    <circle cx="256" cy="205" r="102" fill="#C9A24A"/>
    <g clip-path="url(#dome)" fill="#9C7A2C">${dots.join('')}</g>
    <rect x="156" y="178" width="36" height="96" fill="#F2EFE6"/>
    <rect x="320" y="178" width="36" height="96" fill="#F2EFE6"/>
    <rect x="116" y="262" width="280" height="150" fill="#F2EFE6"/>
    <rect x="212" y="302" width="88" height="9" fill="#C9A24A"/>
    <rect x="228" y="322" width="56" height="90" fill="#161513"/>
    <rect x="116" y="412" width="280" height="20" fill="#F2EFE6"/>
    <g fill="#161513">${checks.join('')}</g>
  </g>`;
};
const svg = (size, scale) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" fill="#161513"/>${art(scale)}</svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const out = [['icon-512.png',512,1.0],['icon-192.png',192,1.0],['maskable-512.png',512,0.78],['apple-touch-icon.png',180,0.86]];
  for (const [name, size, scale] of out) {
    await p.setViewportSize({width:size, height:size});
    await p.setContent(`<html><body style="margin:0">${svg(size, scale)}</body></html>`);
    await p.screenshot({path: path.join(__dirname, '..', 'icons', name), clip:{x:0,y:0,width:size,height:size}});
  }
  await b.close();
})();
