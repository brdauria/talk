/* Markov-modulated additive-increasing / multiplicative-decreasing process.
   States are indexed 0,...,m-1.
*/

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expFromUniform(u, lambda) {
  return -Math.log(1 - u) / lambda;
}

function discreteFromUniform(u, probs) {
  let s = 0;
  for (let i = 0; i < probs.length; i++) {
    s += probs[i];
    if (u <= s) return i;
  }
  return probs.length - 1; // numerical safety
}

function noise_generator(seed, n) {
  const rng = mulberry32(seed);
  const noise_sample = [];

  for (let k = 0; k < n; k++) {
    noise_sample.push([rng(), rng()]);
  }

  return noise_sample;
}

function jumps_generator(model, path, n) {
  if (path.type !== "free") {
    throw new Error("jumps_generator only handles paths of type 'free'.");
  }

  if (!path.noise) {
    path.noise = { seed: Math.floor(Math.random() * 4294967296) };
  }

  if (!path.noise.noise_sample) {
    if (path.noise.seed === undefined) {
      throw new Error("Missing path.noise.seed.");
    }
    path.noise.noise_sample = noise_generator(path.noise.seed, n);
  }

  const jumps = [];
  let env = path.parameters.start_env;

  for (const [u1, u2] of path.noise.noise_sample) {
    const lambda = model.lambda_vec[env];
    const holdingTime = expFromUniform(u1, lambda);
    const nextEnv = discreteFromUniform(u2, model.Env_tr_prob[env]);

    jumps.push([holdingTime, nextEnv]);

    env = nextEnv;
  }

  path.jumps = jumps;
  return path;
}

function free_path_generator(model, path, n) {
  return jumps_generator(model, path, n);
}

function sample_path_generator(model, path, n) {
  if (!path.jumps) {
    jumps_generator(model, path, n);
  }

  const sample_path = [];

  let t = 0;
  let x = path.parameters.start_value;
  let env = path.parameters.start_env;

  sample_path.push([t, x, env]);

  for (const [dt, nextEnv] of path.jumps) {
    const c = model.c_vec[env];
    const p = model.p_vec[env];

    const xBeforeJump = x + dt / c;
    const xAfterJump = p * xBeforeJump;

    t += dt;
    x = xAfterJump;
    env = nextEnv;

    sample_path.push([t, x, env]);
  }

  path.sample_path = sample_path;
  return path;
}

function standard_palette(env) {
  const colors = [
    "#178a2f",
    "#1268b3",
    "#e66100",
    "#8b5cf6",
    "#d33682",
    "#0891b2",
    "#6b7280",
    "#a16207"
  ];

  return colors[env % colors.length];
}

function graph(model, sample_path, options = {}) {
  const width = options.width ?? 800;
  const height = options.height ?? 500;
  const margin = options.margin ?? 40;
  const palette = options.palette ?? standard_palette;
  const backgroundOpacity = options.backgroundOpacity ?? 0.08;
  const strokeWidth = options.strokeWidth ?? 3;
  const pointRadius = options.point_radius ?? options.markerRadius ?? 5;
  const enableGuidelines = options.enable_guidlines ?? options.enable_guidelines ?? false;
  const upToTime = Number(options.up_to_time);
  const hasCutoff = Number.isFinite(upToTime);
  const futureColor = options.future_color ?? options.futureColor ?? "none"; //"#d1d5db";
  const plotLeft = margin;
  const plotRight = width - margin;
  const plotTop = margin;
  const plotBottom = height - margin;

  const segments = [];

  for (let k = 0; k < sample_path.length - 1; k++) {
    const [t0, x0, e0] = sample_path[k];
    const [t1, x1, e1] = sample_path[k + 1];

    const c = model.c_vec[e0];
    const xBeforeJump = x0 + (t1 - t0) / c;
    const xAfterJump = x1;

    segments.push({
      t0, x0, e0,
      t1, xBeforeJump,
      xAfterJump, e1
    });
  }

  const times = sample_path.map(p => p[0]);
  const values = sample_path.map(p => p[1]);

  for (const s of segments) {
    values.push(s.xBeforeJump);
  }

  const tMax = Math.max(...times);
  const xMax = Math.max(...values);
  const xMin = 0;
  const tRange = tMax > 0 ? tMax : 1;
  const xRange = xMax > xMin ? xMax - xMin : 1;

  const sx = t => plotLeft + (t / tRange) * (plotRight - plotLeft);
  const sy = x => plotBottom - ((x - xMin) / xRange) * (plotBottom - plotTop);
  const isVisible = color => String(color).toLowerCase() !== "none";

  let svg = `
<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="aimd-axis-arrow" markerWidth="10" markerHeight="10"
            refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="black"/>
    </marker>
  </defs>
  <style>
    .axis { stroke: black; stroke-width: 3; marker-end: url(#aimd-axis-arrow); }
    .axis-label { font: italic 18px serif; fill: black; }
    .origin-label { font: 16px sans-serif; fill: black; }
    .jump-guide { stroke-width: 1.5; stroke-dasharray: 7 7; }
  </style>
  <rect width="100%" height="100%" fill="white"/>
`;

  for (const s of segments) {
    const color = palette(s.e0, model);
    const appendBackground = (tStart, tEnd, backgroundColor) => {
      if (!isVisible(backgroundColor)) return;

      svg += `
  <rect x="${sx(tStart)}" y="${plotTop}"
        width="${sx(tEnd) - sx(tStart)}" height="${plotBottom - plotTop}"
        fill="${backgroundColor}" opacity="${backgroundOpacity}"/>
`;
    };

    if (!hasCutoff || s.t1 <= upToTime) {
      appendBackground(s.t0, s.t1, color);
    } else if (s.t0 >= upToTime) {
      appendBackground(s.t0, s.t1, futureColor);
    } else {
      appendBackground(s.t0, upToTime, color);
      appendBackground(upToTime, s.t1, futureColor);
    }
  }

  svg += `
  <line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" class="axis"/>
  <line x1="${plotLeft}" y1="${plotBottom}" x2="${plotLeft}" y2="${plotTop}" class="axis"/>
  <text x="${plotLeft - 20}" y="${plotBottom + 6}" class="origin-label">0</text>
  <text x="${plotRight - 10}" y="${plotBottom + 30}" class="axis-label">t</text>
  <text x="${plotLeft - 32}" y="${plotTop + 8}" class="axis-label">X(t)</text>
`;

  if (enableGuidelines) {
    for (const s of segments) {
      const guideColor = !hasCutoff || s.t1 <= upToTime ? "#9ca3af" : futureColor;

      if (isVisible(guideColor)) {
        svg += `
  <line x1="${sx(s.t1)}" y1="${plotTop}"
        x2="${sx(s.t1)}" y2="${plotBottom}"
        class="jump-guide" stroke="${guideColor}"/>
`;
      }
    }
  }

  let points = "";

  for (const s of segments) {
    const color = palette(s.e0, model);
    const jumpColor = !hasCutoff || s.t1 <= upToTime ? color : futureColor;
    const appendSegment = (tStart, xStart, tEnd, xEnd, segmentColor) => {
      if (!isVisible(segmentColor)) return;

      svg += `
  <line x1="${sx(tStart)}" y1="${sy(xStart)}"
        x2="${sx(tEnd)}" y2="${sy(xEnd)}"
        stroke="${segmentColor}" stroke-width="${strokeWidth}"/>
`;
    };

    if (!hasCutoff || s.t1 <= upToTime) {
      appendSegment(s.t0, s.x0, s.t1, s.xBeforeJump, color);
    } else if (s.t0 >= upToTime) {
      appendSegment(s.t0, s.x0, s.t1, s.xBeforeJump, futureColor);
    } else {
      const c = model.c_vec[s.e0];
      const xAtCutoff = s.x0 + (upToTime - s.t0) / c;

      appendSegment(s.t0, s.x0, upToTime, xAtCutoff, color);
      appendSegment(upToTime, xAtCutoff, s.t1, s.xBeforeJump, futureColor);
    }

    if (isVisible(jumpColor)) {
      svg += `
  <line x1="${sx(s.t1)}" y1="${sy(s.xBeforeJump)}"
        x2="${sx(s.t1)}" y2="${sy(s.xAfterJump)}"
        stroke="${jumpColor}" stroke-width="${strokeWidth}" stroke-dasharray="7 7"/>
`;
    }

    if (isVisible(jumpColor)) {
      points += `
  <circle cx="${sx(s.t1)}" cy="${sy(s.xBeforeJump)}" r="${pointRadius}"
          fill="white" stroke="${jumpColor}" stroke-width="${strokeWidth}"/>

  <circle cx="${sx(s.t1)}" cy="${sy(s.xAfterJump)}" r="${pointRadius}"
          fill="${jumpColor}" stroke="${jumpColor}" stroke-width="${strokeWidth}"/>
`;
    }
  }

  svg += points;

  svg += `</svg>`;
  return svg;
}
