(function (root) {
  "use strict";
  const namespace = "http://www.w3.org/2000/svg";
  const owners = new WeakMap();
  const ranges = Object.freeze({
    stride: [0, 1],
    phase: null,
    wave: [0, 1],
    wavePhase: null,
    present: [0, 1],
    blink: [0, 1],
    wink: [0, 1],
    mouth: [0, 1],
    gazeX: [-1, 1],
    gazeY: [-1, 1],
    lean: [-6, 6],
    bob: [-8, 8],
  });
  const mix = (a, b, t) => a + (b - a) * t;
  const number = (value) => String(Math.round(value * 100000) / 100000);
  const point = (p) => p.map(number).join(" ");
  const lerp = (a, b, t) => a.map((value, i) => mix(value, b[i], t));
  const smooth = (t) => t * t * (3 - 2 * t);

  function stateFrom(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new TypeError("Bend performance state must be an object.");
    const result = Object.fromEntries(
      Object.keys(ranges).map((key) => [key, 0]),
    );
    for (const key of Reflect.ownKeys(input)) {
      if (!Object.prototype.hasOwnProperty.call(ranges, key))
        throw new RangeError("Unknown Bend performance field.");
      const value = input[key];
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new TypeError("Bend performance values must be finite numbers.");
      result[key] = ranges[key]
        ? Math.max(ranges[key][0], Math.min(ranges[key][1], value))
        : value;
    }
    return result;
  }

  // Read the renderer's path data, keeping all control points in absolute coordinates.
  function segments(data) {
    const tokens =
      data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ||
      [];
    const sizes = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4 };
    const output = [];
    let i = 0,
      command,
      cursor = [0, 0],
      start = cursor;
    while (i < tokens.length) {
      if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
      const kind = command && command.toUpperCase();
      if (kind === "Z") {
        output.push({ kind: "Z" });
        cursor = start;
        command = null;
        continue;
      }
      const size = sizes[kind];
      if (!size || i + size > tokens.length)
        throw new TypeError("Unsupported Bend path geometry.");
      const values = tokens.slice(i, i + size).map(Number);
      if (!values.every(Number.isFinite))
        throw new TypeError("Invalid Bend path geometry.");
      i += size;
      const relative = command !== kind;
      const at = (index) => [
        values[index] + (relative ? cursor[0] : 0),
        values[index + 1] + (relative ? cursor[1] : 0),
      ];
      let end;
      if (kind === "H")
        end = [values[0] + (relative ? cursor[0] : 0), cursor[1]];
      else if (kind === "V")
        end = [cursor[0], values[0] + (relative ? cursor[1] : 0)];
      else end = at(size - 2);
      if (kind === "M") {
        output.push({ kind, end });
        start = end;
        command = relative ? "l" : "L";
      } else if (kind === "C")
        output.push({ kind, points: [cursor, at(0), at(2), end] });
      else if (kind === "Q")
        output.push({
          kind: "C",
          points: [
            cursor,
            lerp(cursor, at(0), 2 / 3),
            lerp(end, at(0), 2 / 3),
            end,
          ],
        });
      else output.push({ kind: "L", points: [cursor, end] });
      cursor = end;
    }
    return output;
  }

  function split(points) {
    const a = lerp(points[0], points[1], 0.5),
      b = lerp(points[1], points[2], 0.5),
      c = lerp(points[2], points[3], 0.5);
    const d = lerp(a, b, 0.5),
      e = lerp(b, c, 0.5),
      f = lerp(d, e, 0.5);
    return [
      [points[0], a, d, f],
      [f, e, c, points[3]],
    ];
  }

  function subdivide(points, count) {
    return count
      ? split(points).flatMap((part) => subdivide(part, count - 1))
      : [points];
  }

  function prepare(segment) {
    if (segment.kind === "L") {
      const [a, b] = segment.points;
      const crossesShoulder = (a[1] - 176) * (b[1] - 176) < 0;
      const boundary = crossesShoulder
        ? lerp(a, b, (176 - a[1]) / (b[1] - a[1]))
        : null;
      return (
        boundary
          ? [
              [a, boundary],
              [boundary, b],
            ]
          : [[a, b]]
      ).flatMap(([start, end]) => {
        if (Math.max(start[1], end[1]) <= 176) return [{ kind: "L", end }];
        return subdivide(
          [start, lerp(start, end, 1 / 3), lerp(start, end, 2 / 3), end],
          4,
        ).map((points) => ({ kind: "C", points }));
      });
    }
    if (segment.kind === "C" && segment.points.some((p) => p[1] > 176)) {
      return subdivide(segment.points, 4).map((points) => ({
        kind: "C",
        points,
      }));
    }
    return [segment];
  }

  function step(phase, stride) {
    const tau = Math.PI * 2;
    const t = (((phase % tau) + tau) % tau) / tau;
    // A longer planted sweep and a shorter, eased return make contact legible.
    if (t < 0.6) return [20 * Math.cos((Math.PI * t) / 0.6) * stride, 0];
    const flight = (t - 0.6) / 0.4;
    return [
      -20 * Math.cos(Math.PI * flight) * stride,
      -20 * Math.sin(Math.PI * flight) ** 2 * stride,
    ];
  }

  function create(svg) {
    if (
      !svg ||
      svg.namespaceURI !== namespace ||
      svg.localName !== "svg" ||
      svg.getAttribute("data-bend-pose") !== "rest" ||
      svg.getAttribute("data-bend-expression") !== "welcome"
    ) {
      throw new TypeError(
        "Expected a rest/welcome SVG returned by SituateBend.render.",
      );
    }
    if (owners.has(svg)) owners.get(svg).destroy();
    const part = (name) => {
      const node = svg.querySelector(`[data-bend-part="${name}"]`);
      if (!node) throw new TypeError("Incomplete Bend SVG.");
      return node;
    };
    const figure = part("figure"),
      face = part("face");
    const body = ["depth", "front", "highlight", "inset"].map((name) => {
      const node = part(name);
      return {
        node,
        geometry: segments(node.getAttribute("d")).flatMap(prepare),
      };
    });
    const arms = ["left", "right"].map((side) => {
      const node = part(`${side}-arm`).querySelector("path");
      if (!node) throw new TypeError("Missing Bend arm path.");
      const geometry = segments(node.getAttribute("d"));
      if (
        geometry.length !== 2 ||
        geometry[0].kind !== "M" ||
        geometry[1].kind !== "C"
      )
        throw new TypeError("Expected resting Bend arms.");
      return { node, curves: split(geometry[1].points) };
    });
    const [brows, eyes, mouth] = face.querySelectorAll("path");
    if (!brows || !eyes || !mouth)
      throw new TypeError("Expected the welcome face.");
    const rightEye = eyes.cloneNode(false);
    rightEye.setAttribute("data-bend-performance", "right-eye");
    const ink = face.getAttribute("stroke");
    const saved = [
      [figure, ["style"]],
      [brows, ["d"]],
      [eyes, ["d", "stroke-width"]],
      [mouth, ["d", "fill", "stroke-width"]],
      ...body.map(({ node }) => [node, ["d"]]),
      ...arms.map(({ node }) => [node, ["d"]]),
    ].map(([node, names]) => [
      node,
      names.map((name) => [name, node.getAttribute(name)]),
    ]);
    let destroyed = false;
    function alive() {
      if (destroyed)
        throw new Error("This Bend performance rig has been destroyed.");
    }
    function restore() {
      rightEye.remove();
      for (const [node, attributes] of saved)
        for (const [name, value] of attributes) {
          if (value === null) node.removeAttribute(name);
          else if (node.getAttribute(name) !== value)
            node.setAttribute(name, value);
        }
    }
    function skin(p, feet) {
      const weight = smooth(Math.max(0, Math.min(1, (p[1] - 176) / 80)));
      const offset = feet[p[0] < 160 ? 0 : 1];
      return [p[0] + offset[0] * weight, p[1] + offset[1] * weight];
    }
    function moveArms(s) {
      arms.forEach(({ node, curves }, side) => {
        const wave = side ? s.wave : 0;
        const presentation = s.present * (1 - wave);
        const swing =
          Math.sin(s.phase + side * Math.PI) *
          s.stride *
          (1 - wave) *
          (1 - s.present);
        if (!wave && !presentation && !swing) return;
        const pose = side
          ? [
              [225, 169],
              [247, 169],
              [260, 173],
              [270, 166],
              [277, 161],
              [278, 156],
              [281, 153],
            ]
          : [
              [103, 169],
              [82, 171],
              [68, 183],
              [55, 178],
              [48, 175],
              [44, 168],
              [42, 164],
            ];
        const flutter = Math.sin(s.wavePhase),
          follow = Math.sin(s.wavePhase - 0.6);
        const raised = [
          [225, 169],
          [247, 172],
          [266 + 2 * follow, 160],
          [269 + 3 * follow, 147],
          [272 + 6 * flutter, 135],
          [269 + 8 * flutter, 127],
          [267 + 9 * flutter, 119 + 3 * follow],
        ];
        const baseline = [...curves[0], ...curves[1].slice(1)];
        const points = baseline.map((p, index) => {
          const q = lerp(
            lerp(p, pose[index], presentation),
            side ? raised[index] : p,
            wave,
          );
          const weight = (index / 6) ** 2;
          return [q[0] + swing * 8 * weight, q[1] + swing * 7 * weight];
        });
        let d = `M${point(points[0])}C${points.slice(1, 4).map(point).join(" ")}C${points.slice(4).map(point).join(" ")}`;
        if (wave) {
          const tip = points[6];
          d += `M${point(tip)}l${number((-3 + flutter * 2) * wave)} ${number(-9 * wave)}M${point(tip)}l${number(8 * wave)} ${number((-5 + follow) * wave)}`;
        }
        node.setAttribute("d", d);
      });
    }
    function moveFace(s) {
      const rightClose = 1 - (1 - s.blink) * (1 - s.wink);
      if (s.blink || s.wink || s.gazeX || s.gazeY) {
        const eye = (node, x, close) => {
          const gx = s.gazeX * 1.25,
            gy = s.gazeY;
          const a = [x + gx - 4 * close, 97 + gy + 3 * close];
          const b = [x + gx, 100 + gy + 5 * close];
          const c = [x + gx + 4 * close, 103 + gy - 3 * close];
          node.setAttribute("d", `M${point(a)}Q${point(b)} ${point(c)}`);
          node.setAttribute("stroke-width", number(5.5 - 2.5 * close));
        };
        eye(eyes, 147, s.blink);
        eye(rightEye, 174, rightClose);
        face.appendChild(rightEye);
      }
      if (s.wave || s.wink || s.gazeY) {
        const lift = s.wave + s.gazeY * -0.4;
        brows.setAttribute(
          "d",
          `M142 ${number(88 - lift)}q4-3 8-1M170 ${number(87 - lift - s.wink * 1.5)}q4-2 8 1`,
        );
      }
      if (s.mouth) {
        const baseline = [
          [151, 110],
          [157.66667, 117.33333],
          [164.33333, 117],
          [171, 109],
          [164.33333, 117],
          [157.66667, 117.33333],
          [151, 110],
        ];
        const open = [
          [153, 109],
          [157, 111],
          [164, 111],
          [169, 109],
          [168, 120],
          [154, 121],
          [153, 109],
        ];
        const points = baseline.map((p, i) => lerp(p, open[i], s.mouth));
        mouth.setAttribute(
          "d",
          `M${point(points[0])}C${points.slice(1, 4).map(point).join(" ")}C${points.slice(4).map(point).join(" ")}Z`,
        );
        mouth.setAttribute("fill", ink);
        mouth.setAttribute("stroke-width", number(3.2 - s.mouth));
      }
    }
    const rig = Object.freeze({
      set(state) {
        alive();
        const s = stateFrom(state);
        restore();
        if (s.stride) {
          const phase = s.phase % (Math.PI * 2);
          const feet = [step(phase, s.stride), step(phase + Math.PI, s.stride)];
          for (const { node, geometry } of body)
            node.setAttribute(
              "d",
              geometry
                .map((segment) => {
                  if (segment.kind === "Z") return "Z";
                  if (segment.kind === "M" || segment.kind === "L")
                    return `${segment.kind}${point(skin(segment.end, feet))}`;
                  return `C${segment.points
                    .slice(1)
                    .map((p) => point(skin(p, feet)))
                    .join(" ")}`;
                })
                .join(""),
            );
        }
        moveArms(s);
        moveFace(s);
        if (s.lean || s.bob)
          figure.style.transform = `translateY(${number(s.bob)}px) rotate(${number(s.lean)}deg)`;
      },
      reset() {
        alive();
        restore();
      },
      destroy() {
        if (destroyed) return;
        restore();
        destroyed = true;
        if (owners.get(svg) === rig) owners.delete(svg);
      },
    });
    owners.set(svg, rig);
    return rig;
  }
  root.SituateBendPerformance = Object.freeze({ create });
})(window);
