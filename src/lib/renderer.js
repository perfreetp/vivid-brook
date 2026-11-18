// WebGL2 渲染核心：实例化渲染 + Cell 视锥体裁剪 + 三级 LOD + 图层掩码 + FBO 拾取 + 轴向剖切
import { m4, extractFrustumPlanes, aabbInFrustum, clamp, lerp } from './math.js';
import { CELL_SIZE, LOD_DISTANCE, GALLERY_LENGTH } from './constants.js';

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in mat4 aModel;
layout(location=6) in vec3 aColor;
layout(location=7) in float aPickId;
layout(location=8) in float aLayerMask;
layout(location=9) in float aLod;
layout(location=10) in float aHighlight;

uniform mat4 uViewProj;
uniform int uLOD;
uniform int uLayerMask;
uniform float uSliceX;
uniform int uSliceOn;

out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
flat out int vDiscard;
flat out float vPickId;
flat out float vHighlight;

void main() {
  int mask = int(aLayerMask);
  // 只对元素实际拥有的图层位（非 0 位）做与运算；全被关掉才隐藏
  bool hidden = (mask & uLayerMask) != mask;
  bool lodOff = int(aLod) > uLOD;
  vec4 world = aModel * vec4(aPos, 1.0);
  bool sliced = uSliceOn == 1 && world.x > uSliceX;
  vDiscard = (hidden || lodOff || sliced) ? 1 : 0;
  vNormal = mat3(aModel) * aNormal;
  vColor = aColor;
  vWorld = world.xyz;
  vPickId = aPickId;
  vHighlight = aHighlight;
  gl_Position = uViewProj * world;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
flat in int vDiscard;
flat in float vPickId;
flat in float vHighlight;
uniform vec3 uEye;
uniform int uMode; // 0 正常渲染 1 拾取
out vec4 outColor;

void main() {
  if (vDiscard == 1) discard;
  if (uMode == 1) {
    int id = int(vPickId + 0.5);
    outColor = vec4(float(id & 255) / 255.0,
                    float((id >> 8) & 255) / 255.0,
                    float((id >> 16) & 255) / 255.0, 1.0);
    return;
  }
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(-0.45, 0.8, 0.35));
  float diff = max(dot(n, lightDir), 0.0);
  float rim = pow(1.0 - max(dot(n, normalize(uEye - vWorld)), 0.0), 2.5);
  vec3 base = vColor * (0.42 + 0.62 * diff) + vec3(0.10 * rim);
  float alpha = 1.0;
  if (vHighlight > 0.5) {
    // 选中（1）金色不透明；悬停（2）青色半透明预览
    if (vHighlight > 1.5) {
      base = mix(base, vec3(0.35, 0.9, 1.0), 0.55) + vec3(0.1);
      alpha = 0.5;
    } else {
      base = mix(base, vec3(1.0, 0.85, 0.15), 0.65) + vec3(0.15);
    }
  }
  // 简单距离雾，弱化远处
  float dist = length(uEye - vWorld);
  float fog = clamp((dist - 160.0) / 260.0, 0.0, 0.72);
  base = mix(base, vec3(0.10, 0.12, 0.16), fog);
  outColor = vec4(base, alpha);
}`;

// ---------- 单位几何体 ----------
function makeCube() {
  const p = [], n = [], idx = [];
  const faces = [
    [[1, 0, 0], [-1, 0, 0]], [[0, 1, 0], [0, -1, 0]], [[0, 0, 1], [0, 0, -1]],
  ];
  for (const [nn, neg] of faces) {
    const axis = nn.findIndex((v) => v !== 0);
    const base = p.length / 3;
    for (const s of [1, -1]) {
      const normal = s === 1 ? nn : neg;
      for (const u of [-1, 1]) for (const v of [-1, 1]) {
        const q = [0, 0, 0];
        q[axis] = s;
        const others = [0, 1, 2].filter((i) => i !== axis);
        q[others[0]] = u; q[others[1]] = v;
        p.push(...q); n.push(...normal);
      }
    }
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint16Array(idx) };
}

function makeCylinder(seg = 10) {
  const p = [], n = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const cy = Math.cos(a), sz = Math.sin(a);
    p.push(1, cy, sz); n.push(0, cy, sz);       // +X 端环
    p.push(-1, cy, sz); n.push(0, cy, sz);      // -X 端环
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  // 端盖
  for (const x of [1, -1]) {
    const center = p.length / 3;
    p.push(x, 0, 0); n.push(x, 0, 0);
    const ring = p.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      p.push(x, Math.cos(a), Math.sin(a)); n.push(x, 0, 0);
    }
    for (let i = 0; i < seg; i++) idx.push(center, ring + i, ring + i + 1);
  }
  return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint16Array(idx) };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// 每实例 24 float：mat4(16) + color(3)+pad + pickId + layerMask + lod + highlight
const STRIDE = 24;

export class GalleryRenderer {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.cb = callbacks;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前环境不支持 WebGL2');
    this.gl = gl;
    gl.enable(gl.DEPTH_TEST);
    // 管廊均为封闭实体（箱体/管体），关闭背面剔除以保证各朝向面可靠渲染
    gl.disable(gl.CULL_FACE);
    // 标准 alpha 混合：不透明构件 alpha=1 时为恒等运算，仅悬停半透明预览受影响
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.baseInstanceExt = gl.getExtension('WEBGL_draw_instanced_base_vertex_base_instance');

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.u = {};
    for (const name of ['uViewProj', 'uLOD', 'uLayerMask', 'uSliceX', 'uSliceOn', 'uEye', 'uMode']) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }

    this.geoms = { cube: this.#uploadGeom(makeCube()), cyl: this.#uploadGeom(makeCylinder()) };
    this.meshes = {
      cube: { vbo: null, count: 0, cells: [] },
      cyl: { vbo: null, count: 0, cells: [] },
    };
    this.idToEl = new Map();
    this.idToLoc = new Map();

    // 拾取 FBO
    this.pickTex = gl.createTexture();
    this.pickDepth = gl.createRenderbuffer();
    this.pickFbo = gl.createFramebuffer();

    this.layerMask = 0x3ff;
    this.lod = 0;
    this.sliceX = null;
    this.markers = [];

    this.cam = {
      yaw: 0.55, pitch: 0.42, dist: 70,
      target: [GALLERY_LENGTH / 2, -5.4, 0],
    };
    this.#initControls();
    this.#resize();
    window.addEventListener('resize', this.#resize);
    this.fps = 60; this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.#frame);
  }

  // 上传单位几何体的静态缓冲（不含实例属性）；VAO 由各 mesh 在绑定实例缓冲后创建
  #uploadGeom(g) {
    const gl = this.gl;
    const pv = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pv);
    gl.bufferData(gl.ARRAY_BUFFER, g.positions, gl.STATIC_DRAW);
    const nv = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nv);
    gl.bufferData(gl.ARRAY_BUFFER, g.normals, gl.STATIC_DRAW);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices, gl.STATIC_DRAW);
    return { posVbo: pv, normVbo: nv, indexVbo: ib, indexCount: g.indices.length };
  }

  // 为某 mesh 创建同时持有静态几何 + 实例属性的 VAO
  #createMeshVao(name, instanceVbo) {
    const gl = this.gl;
    const geom = this.geoms[name];
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, geom.posVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geom.normVbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geom.indexVbo);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    for (let i = 2; i <= 10; i++) {
      gl.enableVertexAttribArray(i);
      if (i < 6) gl.vertexAttribPointer(i, 4, gl.FLOAT, false, STRIDE * 4, (i - 2) * 16);
      else if (i === 6) gl.vertexAttribPointer(i, 3, gl.FLOAT, false, STRIDE * 4, 16 * 4);
      else gl.vertexAttribPointer(i, 1, gl.FLOAT, false, STRIDE * 4, (16 + 1 + (i - 7)) * 4);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  // ---------- 模型 -> 实例缓冲（按 cell 排序，cell 即裁剪单元）----------
  setModel(model) {
    const gl = this.gl;
    this.idToEl.clear(); this.idToLoc.clear();
    const buckets = { cube: [], cyl: [] };
    const kindToMesh = (kind) => (kind === 'structure' || kind === 'support' || kind === 'fitting' ? 'cube' : 'cyl');
    let pickId = 1;
    for (const list of Object.values(model.groups)) {
      for (const el of list) {
        const mesh = kindToMesh(el.kind);
        buckets[mesh].push({ el, pickId });
        this.idToEl.set(pickId, el);
        pickId++;
      }
    }
    const cellCount = Math.ceil(GALLERY_LENGTH / CELL_SIZE);
    for (const [meshName, items] of Object.entries(buckets)) {
      items.sort((a, b) => a.el.cellId - b.el.cellId || a.pickId - b.pickId);
      const data = new Float32Array(items.length * STRIDE);
      const cells = Array.from({ length: cellCount }, () => ({ offset: 0, count: 0, visible: true }));
      items.forEach((item, i) => {
        const el = item.el;
        this.idToLoc.set(item.pickId, { mesh: meshName, index: i, cellId: el.cellId });
        this.#writeInstance(data, i, el, item.pickId, 0);
        const c = cells[el.cellId];
        if (c.count === 0) c.offset = i;
        c.count++;
      });
      const mesh = this.meshes[meshName];
      if (!mesh.vbo) mesh.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      mesh.data = data;
      mesh.count = items.length;
      mesh.cells = cells;
      if (mesh.vao) gl.deleteVertexArray(mesh.vao);
      mesh.vao = this.#createMeshVao(meshName, mesh.vbo);
    }
    this.model = model;
    this.#refreshCellVisibility();
  }

  #instanceMatrix(el) {
    const [sx, sy, sz] = el.scale;
    const [px, py, pz] = el.pos;
    const m = new Float32Array(16);
    if (el.axis === 'z') {
      // 局部 X -> 世界 Z（绕 Y 转 -90°）
      m[0] = 0; m[2] = sz; m[5] = sy; m[8] = sx; m[10] = 0;
    } else {
      m[0] = sx; m[5] = sy; m[10] = sz;
    }
    m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
    return m;
  }

  #writeInstance(data, i, el, pickId, highlight) {
    const o = i * STRIDE;
    const m = this.#instanceMatrix(el);
    data.set(m, o);
    data[o + 16] = el.color[0]; data[o + 17] = el.color[1]; data[o + 18] = el.color[2];
    data[o + 19] = 0;
    data[o + 20] = pickId;
    data[o + 21] = el.layerMask;
    data[o + 22] = el.lod;
    data[o + 23] = highlight;
  }

  #patchHighlight(pickId, value) {
    if (!pickId) return;
    const loc = this.idToLoc.get(pickId);
    if (!loc) return;
    const mesh = this.meshes[loc.mesh];
    mesh.data[loc.index * STRIDE + 23] = value;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, (loc.index * STRIDE + 23) * 4, new Float32Array([value]));
  }

  setHighlight(selectedPickId, hoveredPickId) {
    if (this._sel !== selectedPickId) { this.#patchHighlight(this._sel, 0); this._sel = selectedPickId; this.#patchHighlight(selectedPickId, 1); }
    if (this._hov !== hoveredPickId) { this.#patchHighlight(this._hov, 0); this._hov = hoveredPickId; this.#patchHighlight(hoveredPickId, 2); }
  }

  setLayerMask(mask) {
    this.layerMask = mask;
    this.#refreshCellVisibility();
  }

  #refreshCellVisibility() {
    // 关闭的图层不参与裁剪：cell 内若无任何可见实例则整体剔除
    if (!this.model) return;
    for (const mesh of Object.values(this.meshes)) {
      for (const c of mesh.cells) c.visible = false;
      for (const [pid, loc] of this.idToLoc) {
        const el = this.idToEl.get(pid);
        // 元素拥有的图层位必须全部处于开启状态才算可见
        if ((el.layerMask & this.layerMask) === el.layerMask && el.layerMask !== 0) {
          mesh.cells[loc.cellId].visible = true;
        }
      }
    }
  }

  setLOD(lod) { this.lod = lod; }
  setSlice(x) { this.sliceX = x; }

  // ---------- 相机控制 ----------
  #initControls() {
    const cv = this.canvas;
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, t: performance.now() };
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) { this.#hoverPick(e); return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const c = this.cam;
      if (drag.button === 2 || e.shiftKey) {
        const s = c.dist * 0.0016;
        const right = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
        c.target[0] -= dx * s * right[0]; c.target[2] -= dx * s * right[2];
        c.target[1] += dy * s;
      } else {
        c.yaw -= dx * 0.005;
        c.pitch = clamp(c.pitch + dy * 0.005, -1.2, 1.45);
      }
      drag.x = e.clientX; drag.y = e.clientY;
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved && drag.button === 0) this.#clickPick(e);
      drag = null;
    });
    cv.addEventListener('pointerleave', () => this.cb.onHover?.(null));
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const c = this.cam;
      c.dist = clamp(c.dist * Math.exp(e.deltaY * 0.0012), 8, 420);
      const lod = c.dist > LOD_DISTANCE[0] ? 0 : c.dist > LOD_DISTANCE[1] ? 1 : 2;
      if (lod !== this.lod) { this.lod = lod; this.cb.onLOD?.(lod); }
    }, { passive: false });
  }

  #viewProj() {
    const c = this.cam;
    const cp = Math.cos(c.pitch);
    const eye = [
      c.target[0] + c.dist * cp * Math.sin(c.yaw),
      c.target[1] + c.dist * Math.sin(c.pitch),
      c.target[2] + c.dist * cp * Math.cos(c.yaw),
    ];
    this.eye = eye;
    const view = m4.lookAt(eye, c.target, [0, 1, 0]);
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const proj = m4.perspective(Math.PI / 4.5, aspect, 0.3, 6000);
    return { vp: m4.multiply(proj, view), eye };
  }

  // 按可见 cell 绘制：mesh.vao 已同时持有几何与实例属性
  #drawVisibleCells(name, planes) {
    const gl = this.gl;
    const mesh = this.meshes[name];
    if (!mesh.vbo || !mesh.vao) return 0;
    const geom = this.geoms[name];
    gl.bindVertexArray(mesh.vao);
    let drawn = 0;
    mesh.cells.forEach((cell, cid) => {
      if (!cell.visible || cell.count === 0) return;
      const x0 = cid * CELL_SIZE;
      if (!aabbInFrustum(planes, x0, -9.2, -5.8, x0 + CELL_SIZE, -1.6, 4.4)) return;
      if (this.baseInstanceExt) {
        gl.drawElementsInstancedBaseVertexBaseInstance(
          gl.TRIANGLES, geom.indexCount, gl.UNSIGNED_SHORT, 0, cell.count, 0, cell.offset);
      } else {
        // 无扩展：把实例属性指针偏移到本 cell 起始实例（VAO 仍绑定 mesh.vbo）
        const byteBase = cell.offset * STRIDE * 4;
        for (let i = 2; i <= 10; i++) {
          if (i < 6) gl.vertexAttribPointer(i, 4, gl.FLOAT, false, STRIDE * 4, byteBase + (i - 2) * 16);
          else if (i === 6) gl.vertexAttribPointer(i, 3, gl.FLOAT, false, STRIDE * 4, byteBase + 16 * 4);
          else gl.vertexAttribPointer(i, 1, gl.FLOAT, false, STRIDE * 4, byteBase + (16 + 1 + (i - 7)) * 4);
          gl.vertexAttribDivisor(i, 1);
        }
        gl.drawElementsInstanced(gl.TRIANGLES, geom.indexCount, gl.UNSIGNED_SHORT, 0, cell.count);
      }
      drawn++;
    });
    if (!this.baseInstanceExt) {
      // 恢复到零偏移，保持 VAO 处于干净的整缓冲状态
      for (let i = 2; i <= 10; i++) {
        if (i < 6) gl.vertexAttribPointer(i, 4, gl.FLOAT, false, STRIDE * 4, (i - 2) * 16);
        else if (i === 6) gl.vertexAttribPointer(i, 3, gl.FLOAT, false, STRIDE * 4, 16 * 4);
        else gl.vertexAttribPointer(i, 1, gl.FLOAT, false, STRIDE * 4, (16 + 1 + (i - 7)) * 4);
        gl.vertexAttribDivisor(i, 1);
      }
    }
    return drawn;
  }

  #frame = () => {
    this.raf = requestAnimationFrame(this.#frame);
    const now = performance.now();
    const dt = now - this.lastT; this.lastT = now;
    this.fps = lerp(this.fps, 1000 / Math.max(1, dt), 0.08);

    const gl = this.gl;
    const { vp, eye } = this.#viewProj();
    this.vp = vp;
    const planes = extractFrustumPlanes(vp);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.075, 0.09, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uViewProj, false, vp);
    gl.uniform1i(this.u.uLOD, this.lod);
    gl.uniform1i(this.u.uLayerMask, this.layerMask);
    gl.uniform1i(this.u.uSliceOn, this.sliceX == null ? 0 : 1);
    gl.uniform1f(this.u.uSliceX, this.sliceX ?? 0);
    gl.uniform3fv(this.u.uEye, eye);
    gl.uniform1i(this.u.uMode, 0);

    let drawnCells = 0;
    for (const name of Object.keys(this.meshes)) {
      drawnCells += this.#drawVisibleCells(name, planes);
    }
    gl.bindVertexArray(null);
    this.#updateMarkers(vp);
    this.cb.onStats?.({
      fps: Math.round(this.fps),
      cells: drawnCells,
      instances: (this.meshes.cube?.count || 0) + (this.meshes.cyl?.count || 0),
      lod: this.lod,
    });
  };

  #ensurePickTarget() {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  renderPick() {
    const gl = this.gl;
    this.#ensurePickTarget();
    const { vp, eye } = this.#viewProj();
    // 拾取通道需要不透明的 ID 编码，临时关闭混合
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uViewProj, false, vp);
    gl.uniform1i(this.u.uLOD, this.lod);
    gl.uniform1i(this.u.uLayerMask, this.layerMask);
    gl.uniform1i(this.u.uSliceOn, this.sliceX == null ? 0 : 1);
    gl.uniform1f(this.u.uSliceX, this.sliceX ?? 0);
    gl.uniform3fv(this.u.uEye, eye);
    gl.uniform1i(this.u.uMode, 1);
    const planes = extractFrustumPlanes(vp);
    for (const name of Object.keys(this.meshes)) {
      this.#drawVisibleCells(name, planes);
    }
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
  }

  #canvasXY(e) {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / r.width;
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr, cssX: e.clientX - r.left, cssY: e.clientY - r.top };
  }

  #readPickId(px, py) {
    const gl = this.gl;
    const y = this.canvas.height - py;
    const buf = new Uint8Array(4);
    gl.readPixels(px, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf[0] | (buf[1] << 8) | (buf[2] << 16);
  }

  #clickPick(e) {
    const { x, y } = this.#canvasXY(e);
    this.renderPick();
    const id = this.#readPickId(x, y);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    const el = id ? this.idToEl.get(id) : null;
    if (this.cb.onAnnotate && this.annotateMode) {
      const point = el ? this.#unproject(x, y) : this.#rayToDefaultPlane(e);
      this.cb.onAnnotate(point);
      return;
    }
    this.cb.onPick?.(el || null, id);
  }

  #hoverPickThrottle = 0;
  #hoverPick(e) {
    const now = performance.now();
    if (now - this.#hoverPickThrottle < 60) return;
    this.#hoverPickThrottle = now;
    const { x, y } = this.#canvasXY(e);
    this.renderPick();
    const id = this.#readPickId(x, y);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.cb.onHover?.(id ? this.idToEl.get(id) : null, id);
  }

  #unproject(px, py) {
    const gl = this.gl;
    const depth = new Float32Array(1);
    gl.readPixels(px, gl.canvas.height - py, 1, 1, gl.DEPTH_COMPONENT, gl.FLOAT, depth);
    const ndcX = (px / gl.canvas.width) * 2 - 1;
    const ndcY = (py / gl.canvas.height) * 2 - 1;
    const inv = this.#invertMat4(this.vp);
    const from = this.#mulP(inv, [ndcX, ndcY, -1, 1]);
    const to = this.#mulP(inv, [ndcX, ndcY, 1, 1]);
    const t = (depth[0] - from[3]) / (to[3] - from[3]);
    return [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
  }

  #rayToDefaultPlane(e) {
    const { cssX, cssY } = this.#canvasXY(e);
    const r = this.canvas.getBoundingClientRect();
    const ndcX = ((cssX) / r.width) * 2 - 1;
    const ndcY = -(((cssY) / r.height) * 2 - 1);
    const inv = this.#invertMat4(this.vp);
    const a = this.#mulP(inv, [ndcX, ndcY, -1, 1]);
    const b = this.#mulP(inv, [ndcX, ndcY, 1, 1]);
    const planeY = -5.5;
    const t = (planeY - a[1]) / (b[1] - a[1]);
    return [a[0] + (b[0] - a[0]) * t, planeY, a[2] + (b[2] - a[2]) * t];
  }

  #mulP(m, p) {
    const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) o[r] += m[c * 4 + r] * p[c];
    }
    return [o[0] / o[3], o[1] / o[3], o[2] / o[3], o[3]];
  }

  #invertMat4(m) {
    const o = new Float32Array(16);
    const a = m;
    o[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[11]*a[13]+a[13]*a[6]*a[14]-a[13]*a[10]*a[13];
    o[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[11]*a[13]-a[12]*a[6]*a[14]+a[12]*a[10]*a[13];
    o[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[11]*a[12]+a[12]*a[5]*a[13]-a[12]*a[9]*a[13];
    o[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[10]*a[12]-a[12]*a[5]*a[13]+a[12]*a[9]*a[12];
    o[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[11]*a[13]-a[13]*a[2]*a[14]+a[13]*a[10]*a[13];
    o[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[11]*a[12]+a[12]*a[2]*a[14]-a[12]*a[10]*a[12];
    o[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[11]*a[12]-a[12]*a[1]*a[13]+a[12]*a[9]*a[12];
    o[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[10]*a[12]+a[12]*a[1]*a[13]-a[12]*a[9]*a[12];
    o[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[7]*a[13]+a[13]*a[2]*a[14]-a[13]*a[6]*a[13];
    o[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[7]*a[12]-a[12]*a[2]*a[14]+a[12]*a[6]*a[12];
    o[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[7]*a[12]+a[12]*a[1]*a[13]-a[12]*a[5]*a[12];
    o[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[6]*a[12]-a[12]*a[1]*a[13]+a[12]*a[5]*a[12];
    o[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[7]*a[9]-a[9]*a[2]*a[10]+a[9]*a[6]*a[9];
    o[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[7]*a[8]+a[8]*a[2]*a[10]-a[8]*a[6]*a[8];
    o[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[7]*a[8]-a[8]*a[1]*a[9]+a[8]*a[5]*a[8];
    o[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[6]*a[8]+a[8]*a[1]*a[9]-a[8]*a[5]*a[8];
    let det = a[0] * o[0] + a[1] * o[4] + a[2] * o[8] + a[3] * o[12];
    det = 1 / det;
    for (let i = 0; i < 16; i++) o[i] *= det;
    return o;
  }

  project(world) {
    if (!this.vp) return null;
    const c = this.vp;
    const x = world[0], y = world[1], z = world[2];
    const cx = c[0]*x + c[4]*y + c[8]*z + c[12];
    const cy = c[1]*x + c[5]*y + c[9]*z + c[13];
    const cw = c[3]*x + c[7]*y + c[11]*z + c[15];
    if (cw <= 0) return null;
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (cx / cw * 0.5 + 0.5) * r.width,
      y: (-cy / cw * 0.5 + 0.5) * r.height,
      visible: true,
    };
  }

  #updateMarkers() {
    for (const m of this.markers) {
      const s = this.project(m.world);
      if (!s || s.x < -30 || s.x > this.canvas.clientWidth + 30 || s.y < -30 || s.y > this.canvas.clientHeight + 30) {
        m.el.style.display = 'none';
      } else {
        m.el.style.display = '';
        m.el.style.transform = `translate(${s.x - 12}px, ${s.y - 12}px)`;
      }
    }
  }

  setMarkers(markers) { this.markers = markers; }

  #resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.#resize);
  }
}
