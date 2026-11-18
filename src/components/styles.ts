export const sharedCss = `
:host {
  display: block;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  font-size: 13px;
  color: #1e293b;
  --primary: #1d4ed8;
  --primary-light: #dbeafe;
  --border: #cbd5e1;
  --bg: #ffffff;
  --muted: #64748b;
  --danger: #dc2626;
  --warn: #d97706;
}
.panel {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 8px;
  overflow: hidden;
}
.panel > header {
  background: linear-gradient(90deg, #1e3a8a, #2563eb);
  color: #fff;
  padding: 8px 12px;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.5px;
  cursor: pointer;
  user-select: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.panel > header .chev { transition: transform .2s; font-size: 10px; }
.panel.collapsed > header .chev { transform: rotate(-90deg); }
.panel.collapsed .body { display: none; }
.body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
label.row { flex-direction: row; align-items: center; gap: 8px; color: #1e293b; }
input[type="text"], input[type="number"], input[type="date"], select, textarea {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 13px;
  font-family: inherit;
  background: #fff;
  color: #1e293b;
  min-width: 0;
}
input:focus, select:focus, textarea:focus { outline: 2px solid #93c5fd; border-color: var(--primary); }
button {
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
  border-radius: 5px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
button:hover { filter: brightness(1.08); }
button:disabled { opacity: .45; cursor: not-allowed; }
button.ghost { background: #fff; color: var(--primary); }
button.danger { border-color: var(--danger); background: var(--danger); }
button.small { padding: 3px 8px; font-size: 11.5px; }
.row-flex { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tag {
  display: inline-block; padding: 1px 7px; border-radius: 10px;
  background: var(--primary-light); color: #1e40af; font-size: 11px;
}
.tag.warn { background: #fef3c7; color: #92400e; }
.tag.red { background: #fee2e2; color: #991b1b; }
.tag.green { background: #dcfce7; color: #166534; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
td, th { border: 1px solid #e2e8f0; padding: 4px 7px; text-align: left; }
th { background: #f1f5f9; font-weight: 600; }
.scroll { max-height: 230px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
.muted { color: var(--muted); }
.mono { font-family: Consolas, monospace; }
.sep { height: 1px; background: #e2e8f0; margin: 4px 0; }
.file-hint {
  border: 1px dashed var(--border); border-radius: 6px; padding: 8px;
  font-size: 11.5px; color: var(--muted); background: #f8fafc; line-height: 1.6;
}
.range-row { display: flex; align-items: center; gap: 8px; }
.range-row input[type="range"] { flex: 1; }
.value-pill { min-width: 64px; text-align: right; font-family: Consolas, monospace; color: var(--primary); }
`;
