import { BasePanel } from './base';
import { store } from '../state/store';
import { ctx } from './context';

/** 管理范围等距偏移面板：距离、圆角/尖角参数 */
export class OffsetPanel extends BasePanel {
  constructor() {
    super('③ 管理范围平行线（岸线等距偏移）', 'offset');
  }

  protected mount(): void {
    this.bindStoreRerender();
  }

  render(): void {
    const s = store.get();
    const b = this.body();
    b.innerHTML = '';
    const o = s.offset;

    const enable = this.el('input', { type: 'checkbox' }) as HTMLInputElement;
    enable.checked = o.enabled;
    enable.addEventListener('change', () => {
      store.update({ offset: { ...o, enabled: enable.checked } });
      ctx.refreshScene();
      this.render();
    });

    const dist = this.el('input', { type: 'range', min: '5', max: '200', step: '1', value: String(o.distance) }) as HTMLInputElement;
    const distVal = this.el('span', { class: 'value-pill' }, `${o.distance} m`);
    dist.addEventListener('input', () => {
      store.update({ offset: { ...store.get().offset, distance: Number(dist.value) } });
      distVal.textContent = `${dist.value} m`;
      ctx.refreshScene();
    });

    const corner = this.el('select') as HTMLSelectElement;
    corner.append(new Option('圆角（圆弧过渡）', 'round'), new Option('尖角（斜接，超限回退斜切）', 'miter'));
    corner.value = o.corner;
    corner.addEventListener('change', () => {
      store.update({ offset: { ...store.get().offset, corner: corner.value as 'round' | 'miter' } });
      ctx.refreshScene();
      this.render();
    });

    b.append(
      this.el('label', { class: 'row' }, enable, document.createTextNode('启用管理范围平行线')),
      this.el('label', { class: 'row' },
        this.el('div', { class: 'range-row', style: 'width:100%' },
          document.createTextNode('偏移距离'), dist, distVal
        )
      ),
      this.el('label', {}, '角部处理方式', corner)
    );

    if (o.corner === 'round') {
      const seg = this.el('input', { type: 'range', min: '4', max: '32', step: '2', value: String(o.roundSegments) }) as HTMLInputElement;
      const segVal = this.el('span', { class: 'value-pill' }, String(o.roundSegments));
      seg.addEventListener('input', () => {
        store.update({ offset: { ...store.get().offset, roundSegments: Number(seg.value) } });
        segVal.textContent = seg.value;
        ctx.refreshScene();
      });
      b.append(this.el('label', { class: 'row' },
        this.el('div', { class: 'range-row', style: 'width:100%' },
          document.createTextNode('圆弧分段数'), seg, segVal
        )
      ));
    } else {
      const ml = this.el('input', { type: 'range', min: '1', max: '8', step: '0.1', value: String(o.miterLimit) }) as HTMLInputElement;
      const mlVal = this.el('span', { class: 'value-pill' }, String(o.miterLimit));
      ml.addEventListener('input', () => {
        store.update({ offset: { ...store.get().offset, miterLimit: Number(ml.value) } });
        mlVal.textContent = Number(ml.value).toFixed(1);
        ctx.refreshScene();
      });
      b.append(
        this.el('label', { class: 'row' },
          this.el('div', { class: 'range-row', style: 'width:100%' },
            document.createTextNode('斜接限制（倍数，超出转斜切）'), ml, mlVal
          )
        )
      );
    }

    b.append(this.el('div', { class: 'file-hint' },
      '紫色虚线为两岸堤顶线向河道外侧的等距偏移线，即水利工程管理范围边界。'
    ));
  }
}
