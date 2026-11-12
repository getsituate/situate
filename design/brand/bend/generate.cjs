"use strict";
const fs = require("node:fs");
const path = require("node:path");
const bend = require("./bend.js");

if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  console.error("Usage: node generate.cjs [--check]");
  process.exit(2);
}
const check = process.argv.includes("--check");
const directory = path.join(__dirname, "svg");
const files = new Map();
for (const pose of bend.poseNames) {
  for (const expression of bend.expressionNames) {
    const name = `${pose}-${expression}`;
    files.set(
      `${name}.svg`,
      bend.render({
        idPrefix: `bend-${name}`,
        pose,
        expression,
        title: `Bend — ${pose}, ${expression}`,
      }),
    );
  }
}
files.set(
  "bend-master.svg",
  bend.render({ idPrefix: "bend-master", title: "Bend — welcome wave" }),
);
let drift = false;
if (!check) fs.mkdirSync(directory, { recursive: true });
for (const [name, content] of files) {
  const target = path.join(directory, name);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
      console.error(`SVG differs or is missing: ${name}`);
      drift = true;
    }
  } else fs.writeFileSync(target, content);
}
if (fs.existsSync(directory)) {
  for (const name of fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".svg"))) {
    if (!files.has(name)) {
      console.error(`Unexpected SVG export: ${name}`);
      drift = true;
    }
  }
}
const anatomy = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 650" role="img" aria-labelledby="anatomy-title anatomy-desc">
<title id="anatomy-title">Bend construction and paint order</title>
<desc id="anatomy-desc">The two arm origins sit inside the opaque body. Rear arms are painted before the depth, front, highlight and inset. The face stays on the crown. The lower opening stays empty.</desc>
<rect width="960" height="650" rx="20" fill="#fff7e3"/>
<g font-family="system-ui, sans-serif" fill="#30203e">
<text x="36" y="48" font-size="26" font-weight="700">One open arch. Two hidden arm origins.</text>
<text x="36" y="78" font-size="15">Coordinates use the unscaled 320 × 320 character canvas.</text>
<g transform="translate(35 120)">${bend.render({ idPrefix: "anatomy-character", decorative: true })}
<g fill="none" stroke="#30203e" stroke-width="1" stroke-dasharray="3 3">
<rect x="138" y="79" width="44" height="41"/><path d="M91 145V275M124 145V275M195 145V275M243 145V275M35 169H290"/>
</g>
<g fill="#fff7e3" stroke="#30203e" stroke-width="1.5"><circle cx="103" cy="169" r="4"/><circle cx="225" cy="169" r="4"/></g>
<path d="M103 169 55 105H0M225 169 267 214H320M160 120V48H240" fill="none" stroke="#30203e"/>
<g font-size="12"><text x="0" y="99">103, 169</text><text x="259" y="232">225, 169</text><text x="244" y="51">Face box</text><text x="126" y="290">Open below</text></g>
</g>
<g transform="translate(445 133)" font-size="16">
<text x="0" y="0" font-size="20" font-weight="700">Back → front</text>
<g transform="translate(0 25)"><rect width="32" height="22" rx="7" fill="${bend.colors.body}"/><text x="48" y="17">1. Rear arms, clipped outside the opening</text></g>
<g transform="translate(0 70)"><rect width="32" height="22" rx="7" fill="${bend.colors.depth}"/><text x="48" y="17">2. Opaque extruded depth</text></g>
<g transform="translate(0 115)"><rect width="32" height="22" rx="7" fill="${bend.colors.body}"/><text x="48" y="17">3. Opaque front surface</text></g>
<g transform="translate(0 160)"><rect width="32" height="22" rx="7" fill="${bend.colors.highlight}"/><text x="48" y="17">4. Outer highlight, then inner inset</text></g>
<g transform="translate(0 205)"><rect width="32" height="22" rx="7" fill="${bend.colors.ink}"/><text x="48" y="17">5. Face on the crown</text></g>
<g transform="translate(0 250)"><rect width="32" height="22" rx="7" fill="${bend.colors.lemon}"/><text x="48" y="17">6. Optional prop and gripping hands</text></g>
</g>
<path d="M36 476H924" stroke="#ad9284"/>
<text x="36" y="517" font-size="18" font-weight="700">An origin is not a visible shoulder stroke.</text>
<text x="36" y="548" font-size="16">At y = 169, the left surface spans x = 91–124; the right opaque silhouette spans ≈196–241.</text>
<text x="36" y="577" font-size="16">The body covers both 13-unit round caps. Rotation happens around these same fixed origins.</text>
<text x="36" y="606" font-size="16">Never bring a rear-arm group above the body. A book may cross the opening; anatomy never closes it.</text>
</g>
</svg>\n`;
const diagramPath = path.join(__dirname, "anatomy.svg");
if (check) {
  if (
    !fs.existsSync(diagramPath) ||
    fs.readFileSync(diagramPath, "utf8") !== anatomy
  ) {
    console.error("SVG differs or is missing: anatomy.svg");
    drift = true;
  }
} else fs.writeFileSync(diagramPath, anatomy);
if (drift) process.exitCode = 1;
else
  console.log(
    `${check ? "Verified" : "Generated"} ${files.size} Bend exports and the anatomy diagram.`,
  );
