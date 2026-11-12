(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SituateBend = api;
})(typeof window === "undefined" ? null : window, function () {
  "use strict";

  const colors = Object.freeze({
    body: "#a77bff",
    depth: "#56329b",
    highlight: "#d9c6ff",
    inset: "#7045bd",
    ink: "#30203e",
    cream: "#fff7e3",
    white: "#fffefa",
    orange: "#ff874d",
    lemon: "#f4f06d",
    sky: "#48b7ff",
    pageLine: "#ad9284",
    cardDepth: "#d7ad38",
    paper: "#f6f3ee",
    muted: "#6a5c70",
    violet: "#8651ed",
    deep: "#6232bc",
    cobalt: "#305cf4",
    peach: "#ffc3a3",
    line: "#d9d0df",
  });
  const geometry = Object.freeze({
    depth:
      "M105 270V148c0-82 131-89 136-3l2 113c0 15-13 21-23 15l-9-8-2-115c-1-33-84-30-85 2v110c0 15-9 24-19 8Z",
    front:
      "M91 264V141c0-82 132-88 136-2l2 112c0 17-30 19-31 3l-3-111c-1-33-71-29-71 3v115c0 19-33 22-33 3Z",
    highlight: "M101 257V142c0-35 22-61 54-64",
    inset: "M204 143l2 106",
  });
  const expressions = Object.freeze({
    welcome:
      '<path d="M142 88q4-3 8-1m20 0q4-2 8 1" stroke-width="2.4"/><path d="M147 97v6m27-6v6" stroke-width="5.5"/><path d="M151 110q10 11 20-1" stroke-width="3.2"/>',
    curious:
      '<path d="m144 90 8-2m15-4q5-4 10-1" stroke-width="2.4"/><path d="M149 98v4m24-8v8" stroke-width="5.5"/><ellipse cx="164" cy="112" rx="3.5" ry="4.5" stroke-width="2.6"/>',
    thinking:
      '<path d="M141 88q5-3 10-1m15 0q5-2 10 1" stroke-width="2.4"/><path d="M144 97h9m16 0h9" stroke-width="3"/><path d="M146 98v4m25-4v4" stroke-width="4"/><path d="M155 111h10" stroke-width="3"/>',
    pleased:
      '<path d="M142 88q4-3 8 0m20 0q4-3 8 0" stroke-width="2.4"/><path d="M142 101q5-9 10 0m17 0q5-9 10 0" stroke-width="3.3"/><path d="M151 109q10 14 21 0q-10 5-21 0Z" stroke-width="2.5"/>',
    unsure:
      '<path d="M142 88q4-4 9-2m19 5h9" stroke-width="2.4"/><path d="M148 97v6m27-3v4" stroke-width="5"/><path d="M151 113q4-3 9 0t10 0" stroke-width="2.7"/>',
  });
  const poses = Object.freeze({
    rest: Object.freeze({
      left: "M103 169C79 173 65 187 59 208",
      right: "M225 169C249 176 259 191 262 212",
    }),
    wave: Object.freeze({
      left: "M103 169C79 173 65 187 59 208",
      right: "M225 169C253 169 276 149 267 127m0 0-3-12m3 12 8-7",
    }),
    read: Object.freeze({
      left: "M103 169C63 179 72 210 118 216",
      right: "M225 169C269 183 268 207 215 214",
    }),
    carry: Object.freeze({
      left: "M103 169C57 188 66 218 108 235",
      right: "M225 169C279 187 272 219 230 233",
    }),
    celebrate: Object.freeze({
      left: "M103 169C70 170 55 154 45 124",
      right: "M225 169C249 173 264 150 270 125",
    }),
    point: Object.freeze({
      left: "M103 169C79 173 65 187 59 208",
      right: "M225 169C251 172 261 149 278 148m0 0 15-1m-15 1 5 9",
    }),
  });
  const expressionNames = Object.freeze(Object.keys(expressions));
  const poseNames = Object.freeze(Object.keys(poses));
  const armOrigins = Object.freeze({
    left: Object.freeze([103, 169]),
    right: Object.freeze([225, 169]),
  });
  const escapeXML = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[character],
    );

  function prop(pose) {
    if (pose === "read")
      return `<g transform="translate(0 12)">
<path d="m120 164 44 10 46-16 5 67-48 17-44-12Z" fill="${colors.ink}"/>
<path d="m125 160 39 9 40-15 5 65-42 16-39-11Z" fill="${colors.cream}"/>
<path d="m164 170 3 65m-32-56 18 5m-17 7 18 5m24-19 16-6m-15 18 16-6" stroke="${colors.pageLine}" stroke-width="2" fill="none"/>
<path d="m145 225 8 2 1 26-6-6-5 3Z" fill="${colors.orange}"/>
<path data-bend-part="hands" d="m111 199 13 5m86-4 10-9" stroke="${colors.body}" stroke-width="13" stroke-linecap="round"/>
</g>`;
    if (pose === "carry")
      return `<g transform="translate(0 18)">
<rect x="93" y="187" width="142" height="23" rx="5" fill="${colors.lemon}"/>
<rect x="104" y="167" width="125" height="21" rx="4" fill="${colors.sky}"/>
<path d="M110 173h110m-98 8h98" stroke="${colors.white}" stroke-width="2"/>
<rect x="107" y="207" width="132" height="24" rx="4" fill="${colors.orange}"/>
<path data-bend-part="hands" d="m112 214 16 1m90 1 13-2" stroke="${colors.body}" stroke-width="12" stroke-linecap="round"/>
</g>`;
    if (pose === "celebrate")
      return `<g transform="rotate(12 265 104)">
<rect x="243" y="78" width="45" height="51" rx="8" fill="${colors.cardDepth}"/>
<rect x="239" y="73" width="45" height="51" rx="8" fill="${colors.lemon}"/>
<path d="m250 97 7 7 14-17" fill="none" stroke="${colors.ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;
    return "";
  }

  function render(options = {}) {
    const {
      idPrefix,
      pose = "wave",
      expression = "welcome",
      title = "Bend",
      decorative = false,
    } = options;
    if (
      typeof idPrefix !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(idPrefix)
    ) {
      throw new TypeError(
        "idPrefix must start with a letter and contain only letters, digits, underscores or hyphens.",
      );
    }
    if (!poseNames.includes(pose)) throw new RangeError("Unknown Bend pose.");
    if (!expressionNames.includes(expression))
      throw new RangeError("Unknown Bend expression.");
    if (
      typeof title !== "string" ||
      // eslint-disable-next-line no-control-regex -- XML titles must reject forbidden control characters.
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(
        title,
      )
    )
      throw new TypeError("title must be valid XML text.");
    if (typeof decorative !== "boolean")
      throw new TypeError("decorative must be a boolean.");
    if (!decorative && !title.trim())
      throw new TypeError("Informative Bend artwork needs a nonempty title.");
    const id = escapeXML(idPrefix);
    const accessible = decorative
      ? 'aria-hidden="true"'
      : `role="img" aria-labelledby="${id}-title"`;
    const arm = (side) =>
      `<g clip-path="url(#${id}-${side}-exterior)"><g data-bend-part="${side}-arm" data-bend-origin="${armOrigins[side].join(" ")}" style="transform-box:view-box;transform-origin:${armOrigins[side][0]}px ${armOrigins[side][1]}px"><path d="${poses[pose][side]}" fill="none" stroke="${colors.body}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></g></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320" ${accessible} focusable="false" data-bend-pose="${escapeXML(pose)}" data-bend-expression="${escapeXML(expression)}">
${decorative ? "" : `<title id="${id}-title">${escapeXML(title)}</title>`}
<defs>
<clipPath id="${id}-left-exterior" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="124" height="320"/></clipPath>
<clipPath id="${id}-right-exterior" clipPathUnits="userSpaceOnUse"><rect x="195" y="0" width="125" height="320"/></clipPath>
</defs>
<g data-bend-part="figure" style="transform-box:view-box;transform-origin:160px 270px">
<g data-bend-part="rear-arms">${arm("left")}${arm("right")}</g>
<g data-bend-part="body">
<path data-bend-part="depth" d="${geometry.depth}" fill="${colors.depth}"/>
<path data-bend-part="front" d="${geometry.front}" fill="${colors.body}"/>
<path data-bend-part="highlight" d="${geometry.highlight}" fill="none" stroke="${colors.highlight}" stroke-width="3" stroke-linecap="round"/>
<path data-bend-part="inset" d="${geometry.inset}" fill="none" stroke="${colors.inset}" stroke-width="2" stroke-linecap="round"/>
</g>
<g data-bend-part="face" fill="none" stroke="${colors.ink}" stroke-linecap="round" stroke-linejoin="round" style="transform-box:view-box;transform-origin:160px 100px">${expressions[expression]}</g>
<g data-bend-part="prop">${prop(pose)}</g>
</g>
</svg>\n`;
  }

  return Object.freeze({
    render,
    colors,
    geometry,
    expressions,
    poses,
    expressionNames,
    poseNames,
    armOrigins,
  });
});
