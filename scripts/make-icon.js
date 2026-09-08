// Render assets/icon.svg -> icon.png (512) and icon.ico (multi-size).
const fs = require("node:fs");
const path = require("node:path");
const { Resvg } = require("@resvg/resvg-js");
const pngToIco = require("png-to-ico");

const assets = path.join(__dirname, "..", "assets");
const svg = fs.readFileSync(path.join(assets, "icon.svg"), "utf8");

function render(size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

(async () => {
  fs.writeFileSync(path.join(assets, "icon.png"), render(512));
  const pngs = [16, 24, 32, 48, 64, 128, 256].map((s) => {
    const p = path.join(assets, `icon-${s}.png`);
    fs.writeFileSync(p, render(s));
    return p;
  });
  fs.writeFileSync(path.join(assets, "icon.ico"), await pngToIco(pngs));
  for (const p of pngs) fs.unlinkSync(p);
  console.log("icon.png + icon.ico written");
})();
