import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--disable-gpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
await page.goto('about:blank');
const result = await page.evaluate(() => new Promise((resolve) => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  document.body.appendChild(c);
  const gl = c.getContext('webgl2');
  const vs = `#version 300 es
  layout(location=0) in vec2 aPos;
  layout(location=2) in vec4 aOffset;
  void main(){ gl_Position = vec4(aPos + aOffset.xy, 0, 1); gl_PointSize = 4.0; }`;
  const fs = `#version 300 es
  precision highp float; out vec4 o;
  void main(){ o = vec4(1.0, 0.0, 0.0, 1.0); }`;
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return gl.getShaderInfoLog(sh); return sh; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p); gl.useProgram(p);
  // 三角形 3 顶点
  const quad = new Float32Array([-0.2, -0.2, 0.2, -0.2, 0, 0.3]);
  const v0 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, v0);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // 2 个实例的偏移（location 2，divisor=1）
  const offsets = new Float32Array([-0.5, 0, 0, 0, 0.5, 0, 0, 0]);
  const v1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, v1);
  gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);
  gl.viewport(0, 0, 256, 256);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 2);
  const b = new Uint8Array(256 * 256 * 4);
  gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, b);
  let red = 0;
  for (let i = 0; i < b.length; i += 4) if (b[0] === 255 || b[i] === 255) red++;
  resolve({ redPixels: red, err: gl.getError(), vendor: gl.getParameter(gl.VERSION) });
}));
console.log(JSON.stringify(result, null, 2));
await browser.close();
