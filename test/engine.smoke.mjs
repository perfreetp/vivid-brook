// src/model/types.ts
var LIGHT_PRESETS = {
  street: { label: "\u8DEF\u706F", height: 6, radius: 18, kelvin: 3e3, intensity: 2600, size: 0.4 },
  courtyard: { label: "\u5EAD\u9662\u706F", height: 3.5, radius: 11, kelvin: 2700, intensity: 1e3, size: 0.25 },
  wall: { label: "\u6D17\u5899\u706F", height: 4, radius: 9, kelvin: 3e3, intensity: 1300, size: 0.6 }
};

// src/engine/solar.ts
function sunPosition(date, hour, latitude) {
  const decl = (date === "summer" ? 23.44 : -23.44) * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const H = (hour - 12) * 15 * Math.PI / 180;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAz = (Math.sin(decl) - Math.sin(altitude) * Math.sin(lat)) / Math.max(1e-6, Math.cos(altitude) * Math.cos(lat));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (H > 0) azimuth = 2 * Math.PI - azimuth;
  return { altitude, azimuth };
}
function sunDir(az) {
  return { x: Math.sin(az), y: -Math.cos(az) };
}

// src/engine/lighting.ts
var GRID_W = 220;
var GRID_H = 150;
var FLOOR_H = 3;
var DARK_LUX = 20;
function kelvinToRgb(k) {
  const t = Math.max(1e3, Math.min(4e4, k)) / 100;
  let r, g, b;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function rasterizeHeights(scene3) {
  const h = new Float32Array(GRID_W * GRID_H);
  for (const b of scene3.buildings) {
    const bh = b.floors * FLOOR_H;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of b.polygon) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(GRID_W - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(GRID_H - 1, Math.ceil(maxY));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (pointInPoly(gx + 0.5, gy + 0.5, b.polygon)) {
          const i = gy * GRID_W + gx;
          if (h[i] < bh) h[i] = bh;
        }
      }
    }
  }
  return h;
}
function heightAt(hm2, x, y) {
  const gx = Math.floor(x), gy = Math.floor(y);
  if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return 0;
  return hm2[gy * GRID_W + gx];
}
function boxBlur(src, w, h, radius) {
  if (radius <= 0) return src;
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const n = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      const xa = Math.min(w - 1, x + radius + 1), xs = Math.max(0, x - radius);
      acc += src[y * w + xa] - src[y * w + xs];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / n;
      const ya = Math.min(h - 1, y + radius + 1), ys = Math.max(0, y - radius);
      acc += tmp[ya * w + x] - tmp[ys * w + x];
    }
  }
  return dst;
}
function lightVisibility(light, hm2) {
  const R = Math.ceil(light.radius);
  const x0 = Math.max(0, Math.floor(light.pos.x - R));
  const y0 = Math.max(0, Math.floor(light.pos.y - R));
  const x1 = Math.min(GRID_W - 1, Math.ceil(light.pos.x + R));
  const y1 = Math.min(GRID_H - 1, Math.ceil(light.pos.y + R));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bin = new Float32Array(w * h);
  const lh = light.height;
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const cx = x0 + gx + 0.5, cy = y0 + gy + 0.5;
      const dx = cx - light.pos.x, dy = cy - light.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > light.radius) continue;
      const steps = Math.max(1, Math.ceil(dist));
      let blocked = false;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const bh = heightAt(hm2, light.pos.x + dx * t, light.pos.y + dy * t);
        if (bh > lh * (1 - t) + 0.01) {
          blocked = true;
          break;
        }
      }
      bin[gy * w + gx] = blocked ? 0 : 1;
    }
  }
  const size = LIGHT_PRESETS[light.type].size;
  const radius = Math.max(1, Math.min(4, Math.round(size * 4)));
  return { vis: boxBlur(bin, w, h, radius), x0, y0, w, h };
}
function computeLighting(scene3, env) {
  const N = GRID_W * GRID_H;
  const lux = new Float32Array(N);
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const hm2 = rasterizeHeights(scene3);
  const sun = sunPosition(env.date, env.hour, env.latitude);
  const sinAlt = Math.sin(sun.altitude);
  const night2 = sun.altitude <= 0;
  let sunLux = 0;
  if (!night2) {
    const direct = 1e5 * sinAlt;
    const diffuse = 12e3 * Math.sqrt(sinAlt);
    sunLux = direct;
    const sd = sunDir(sun.azimuth);
    let maxH = 0;
    for (let i = 0; i < N; i++) if (hm2[i] > maxH) maxH = hm2[i];
    const tanAlt = Math.tan(sun.altitude);
    const maxLen = maxH / tanAlt;
    const sunK = 2e3 + 4500 * sinAlt;
    const [sr, sg, sb] = kelvinToRgb(sunK);
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const i = gy * GRID_W + gx;
        let e = diffuse;
        if (hm2[i] < 0.01) {
          let shaded = false;
          const steps = Math.ceil(maxLen);
          for (let s = 1; s <= steps; s++) {
            const d = s;
            const bh = heightAt(hm2, gx + 0.5 + sd.x * d, gy + 0.5 + sd.y * d);
            if (bh >= d * tanAlt) {
              shaded = true;
              break;
            }
          }
          if (!shaded) e += direct;
        }
        lux[i] += e;
        R[i] += e * sr;
        G[i] += e * sg;
        B[i] += e * sb;
      }
    }
  } else {
    for (let i = 0; i < N; i++) {
      lux[i] += 0.3;
      R[i] += 0.1;
      G[i] += 0.1;
      B[i] += 0.12;
    }
  }
  for (const l of scene3.lights) {
    if (!l.on) continue;
    const { vis, x0, y0, w, h } = lightVisibility(l, hm2);
    const [lr, lg, lb] = kelvinToRgb(l.kelvin);
    const h2 = l.height * l.height;
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const v = vis[gy * w + gx];
        if (v <= 1e-3) continue;
        const cx = x0 + gx + 0.5, cy = y0 + gy + 0.5;
        const dx = cx - l.pos.x, dy = cy - l.pos.y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2);
        if (d > l.radius) continue;
        let e = l.intensity * l.height / Math.pow(h2 + d2, 1.5);
        const edge = d / l.radius;
        if (edge > 0.8) e *= 1 - (edge - 0.8) / 0.2;
        e *= v;
        const i = (y0 + gy) * GRID_W + (x0 + gx);
        lux[i] += e;
        R[i] += e * lr;
        G[i] += e * lg;
        B[i] += e * lb;
      }
    }
  }
  const dark = new Uint8Array(N);
  for (let i = 0; i < N; i++) dark[i] = lux[i] < DARK_LUX ? 1 : 0;
  const zones = [];
  const seen = new Uint8Array(N);
  const stack = [];
  let zid = 0;
  for (let i = 0; i < N; i++) {
    if (!dark[i] || seen[i]) continue;
    zid++;
    let cells = 0, sx = 0, sy = 0;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % GRID_W, cy = c / GRID_W | 0;
      cells++;
      sx += cx;
      sy += cy;
      if (cx > 0 && dark[c - 1] && !seen[c - 1]) {
        seen[c - 1] = 1;
        stack.push(c - 1);
      }
      if (cx < GRID_W - 1 && dark[c + 1] && !seen[c + 1]) {
        seen[c + 1] = 1;
        stack.push(c + 1);
      }
      if (cy > 0 && dark[c - GRID_W] && !seen[c - GRID_W]) {
        seen[c - GRID_W] = 1;
        stack.push(c - GRID_W);
      }
      if (cy < GRID_H - 1 && dark[c + GRID_W] && !seen[c + GRID_W]) {
        seen[c + GRID_W] = 1;
        stack.push(c + GRID_W);
      }
    }
    zones.push({ id: zid, cells, area: cells, cx: sx / cells, cy: sy / cells });
  }
  zones.sort((a, b) => b.cells - a.cells);
  const darkArea = zones.reduce((s, z) => s + z.cells, 0);
  const blockStats = scene3.blocks.map((b) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of b.polygon) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    let cells = 0, sum = 0, dk = 0;
    const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(GRID_W - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(GRID_H - 1, Math.ceil(maxY));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (!pointInPoly(gx + 0.5, gy + 0.5, b.polygon)) continue;
        const i = gy * GRID_W + gx;
        cells++;
        sum += lux[i];
        if (dark[i]) dk++;
      }
    }
    return {
      id: b.id,
      name: b.name,
      cells,
      avgLux: cells ? sum / cells : 0,
      darkCells: dk,
      darkRatio: cells ? dk / cells : 0
    };
  });
  return {
    lux,
    r: R,
    g: G,
    b: B,
    dark,
    zones,
    darkArea,
    blockStats,
    sunAltDeg: sun.altitude * 180 / Math.PI,
    sunAzDeg: sun.azimuth * 180 / Math.PI,
    sunLux,
    night: night2
  };
}

// test/engine.smoke.ts
var scene = {
  buildings: [
    { id: "b1", name: "A", floors: 3, polygon: [{ x: 50, y: 50 }, { x: 70, y: 50 }, { x: 70, y: 60 }, { x: 50, y: 60 }] }
  ],
  lights: [
    { id: "l1", type: "street", name: "L1", pos: { x: 100, y: 75 }, height: 6, radius: 18, kelvin: 3e3, intensity: 2600, on: true }
  ],
  blocks: [
    { id: "q1", name: "\u8857\u574A1", polygon: [{ x: 40, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 120 }, { x: 40, y: 120 }] }
  ],
  annotations: []
};
var s1 = sunPosition("summer", 12, 31.3);
var s2 = sunPosition("winter", 20, 31.3);
console.log("\u590F\u81F3\u6B63\u5348\u9AD8\u5EA6\u89D2(\u5E94~82\xB0):", (s1.altitude * 180 / Math.PI).toFixed(1));
console.log("\u51AC\u81F320\u70B9\u9AD8\u5EA6\u89D2(\u5E94<0, \u591C\u665A):", (s2.altitude * 180 / Math.PI).toFixed(1));
var hm = rasterizeHeights(scene);
console.log("\u5EFA\u7B51\u5185\u9AD8\u5EA6(\u5E949):", hm[55 * GRID_W + 55], " \u5EFA\u7B51\u5916(\u5E940):", hm[10 * GRID_W + 10]);
var day = computeLighting(scene, { date: "summer", hour: 12, latitude: 31.3 });
console.log("--- \u590F\u81F3\u6B63\u5348 ---");
console.log("\u5F00\u9614\u5730\u7167\u5EA6(\u5E94>50000):", day.lux[75 * GRID_W + 100].toFixed(0));
console.log("\u6697\u533A\u5757\u6570(\u767D\u5929\u5E94\u5F88\u5C11):", day.zones.length, " \u6697\u533A\u9762\u79EF:", day.darkArea);
console.log("\u8857\u574A\u5E73\u5747\u7167\u5EA6:", day.blockStats[0].avgLux.toFixed(0), " \u6697\u533A\u5360\u6BD4:", (day.blockStats[0].darkRatio * 100).toFixed(1) + "%");
var night = computeLighting(scene, { date: "winter", hour: 20, latitude: 31.3 });
var li = 75 * GRID_W + 100;
console.log("--- \u51AC\u81F320\u70B9(\u591C\u665A) ---");
console.log("night \u6807\u5FD7(\u5E94true):", night.night);
console.log("\u706F\u4E0B\u7167\u5EA6(\u5E94>20):", night.lux[li].toFixed(1));
console.log("\u8FDC\u5904\u6697\u683C\u7167\u5EA6(\u5E94<20):", night.lux[10 * GRID_W + 10].toFixed(2));
console.log("\u6697\u533A\u5757\u6570:", night.zones.length, " \u6697\u533A\u9762\u79EF:", night.darkArea);
console.log("\u8857\u574A\u5E73\u5747\u7167\u5EA6:", night.blockStats[0].avgLux.toFixed(1), " \u6697\u533A\u5360\u6BD4:", (night.blockStats[0].darkRatio * 100).toFixed(1) + "%");
var scene2 = {
  ...scene,
  lights: [{ id: "l2", type: "street", name: "L2", pos: { x: 40, y: 55 }, height: 2, radius: 30, kelvin: 3e3, intensity: 2600, on: true }]
};
var occl = computeLighting(scene2, { date: "winter", hour: 20, latitude: 31.3 });
var behind = 55 * GRID_W + 80;
var front = 55 * GRID_W + 45;
console.log("--- \u906E\u6321\u6D4B\u8BD5(\u706F\u9AD82m, \u5EFA\u7B51\u9AD89m) ---");
console.log("\u906E\u6321\u4FA7\u7167\u5EA6(\u5E94\u63A5\u8FD10.3):", occl.lux[behind].toFixed(2));
console.log("\u65E0\u906E\u6321\u4FA7\u7167\u5EA6(\u5E94\u660E\u663E\u66F4\u5927):", occl.lux[front].toFixed(2));
console.log("OK");
