// 导出 SVG 给加工
import { entityList, state } from './store';
import { KINDS } from './entities';

export function exportSVG() {
  const list = entityList().filter((e) => !e.hidden);
  if (!list.length) return alert('没有可导出的图元');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of list) {
    x0 = Math.min(x0, e.bounds.x0); y0 = Math.min(y0, e.bounds.y0);
    x1 = Math.max(x1, e.bounds.x1); y1 = Math.max(y1, e.bounds.y1);
  }
  const pad = 10;
  const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
  const parts = [];
  for (const e of list) {
    for (const poly of e.geomWorld) {
      const d = poly
        .map((ring) =>
          'M' + ring.map(([x, y]) => `${(x - x0 + pad).toFixed(3)},${(y - y0 + pad).toFixed(3)}`).join('L') + 'Z'
        )
        .join('');
      parts.push(
        `<path d="${d}" fill="${KINDS[e.kind].color}" fill-opacity="0.35" fill-rule="evenodd" ` +
        `stroke="${KINDS[e.kind].color}" stroke-width="0.3" data-kind="${e.kind}" data-id="${e.id}"/>`
      );
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(2)}mm" height="${h.toFixed(2)}mm" ` +
    `viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}">\n` +
    `<title>浇注系统平面布置 ${new Date().toISOString()}</title>\n` +
    parts.join('\n') + '\n</svg>';
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gating-layout-${Date.now()}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
}
