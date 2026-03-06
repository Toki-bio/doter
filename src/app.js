/* ── Doter: main app  v2 ───────────────────────────────────────
   Draws dot plot + axes on a single canvas at screen resolution.
   No CSS transform tricks.  Zoom re-renders at proper pixel size.
   Axes show nucleotide positions like Staden's Dotter.           */

// ── constants ────────────────────────────────────────────────
const AXIS_PAD   = 50;   // px reserved for axis labels (left / top)
const TICK_LEN   = 5;
const FONT       = '11px system-ui, sans-serif';
const AXIS_COL   = '#333';
const TICK_COL   = '#555';

// ── state ────────────────────────────────────────────────────
const S = {
  seqA: '', seqB: '',
  scores: null, rows: 0, cols: 0,
  scoreMin: 0, scoreMax: 1,
  threshold: 0.55, windowSize: 9, zoom: 1,
  showTrace: true, lastRow: -1, lastCol: -1,
  worker: null, computing: false,
  dotImage: null,   // cached 1:1 ImageData of the dot matrix
};

// ── DOM refs ─────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const el = {
  seqA:        $('#seqA'),
  seqB:        $('#seqB'),
  render:      $('#renderBtn'),
  recalc:      $('#recalcBtn'),
  example:     $('#exampleBtn'),
  window:      $('#windowSize'),
  windowOut:   $('#windowSizeValue'),
  threshold:   $('#threshold'),
  thresholdOut:$('#thresholdValue'),
  zoom:        $('#zoomLevel'),
  zoomOut:     $('#zoomLevelValue'),
  mode:        $('#scoreMode'),
  revB:        $('#reverseB'),
  trace:       $('#showTrace'),
  fit:         $('#fitViewBtn'),
  pngBtn:      $('#exportPngBtn'),
  svgBtn:      $('#exportSvgBtn'),
  status:      $('#statusLine'),
  hover:       $('#hoverInfo'),
  aMeta:       $('#alignmentMeta'),
  aPanel:      $('#alignmentPanel'),
  drop:        $('#dropZone'),
  viewport:    $('#canvasViewport'),
  canvas:      $('#plotCanvas'),
  overlay:     $('#overlayCanvas'),
};
const ctx  = el.canvas.getContext('2d',  { alpha: false });
const oCtx = el.overlay.getContext('2d');

// ── helpers ──────────────────────────────────────────────────
function parseFasta(raw) {
  return raw.split(/\r?\n/).filter(l => !l.startsWith('>')).join('').replace(/\s+/g, '').toUpperCase();
}
function revComp(seq) {
  const m = { A:'T', C:'G', G:'C', T:'A', U:'A', N:'N' };
  return [...seq].reverse().map(b => m[b] ?? 'N').join('');
}

// ── worker ───────────────────────────────────────────────────
function getWorker() {
  if (!S.worker) S.worker = new Worker('./src/worker.js');
  return S.worker;
}
function compute(seqA, seqB, windowSize, mode) {
  return new Promise((res, rej) => {
    const w = getWorker();
    const ok = (e) => { w.removeEventListener('message', ok); w.removeEventListener('error', no);
      if (e.data.error) { rej(new Error(e.data.error)); return; } res(e.data); };
    const no = (e) => { w.removeEventListener('message', ok); w.removeEventListener('error', no); rej(e); };
    w.addEventListener('message', ok);
    w.addEventListener('error', no);
    w.postMessage({ seqA, seqB, windowSize, mode });
  });
}

// ── axis tick helpers ────────────────────────────────────────
function niceStep(seqLen, maxTicks) {
  const raw = seqLen / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm <= 1)       step = 1;
  else if (norm <= 2)  step = 2;
  else if (norm <= 5)  step = 5;
  else                 step = 10;
  return Math.max(1, step * mag);
}

// ── rendering ────────────────────────────────────────────────
function normAt(r, c) {
  const range = S.scoreMax - S.scoreMin || 1;
  return (S.scores[r * S.cols + c] - S.scoreMin) / range;
}

function buildDotImage() {
  const { scores, rows, cols } = S;
  if (!scores) return;
  const img = new ImageData(cols, rows);
  const d = img.data;
  const range = S.scoreMax - S.scoreMin || 1;
  const thr = S.threshold;
  for (let i = 0, j = 0; i < rows * cols; i++, j += 4) {
    const n = (scores[i] - S.scoreMin) / range;
    const v = n >= thr ? Math.round((1 - n) * 255) : 255;
    d[j] = v; d[j+1] = v; d[j+2] = v; d[j+3] = 255;
  }
  S.dotImage = img;
}

function render() {
  if (!S.dotImage) return;
  const z = S.zoom;
  const { rows, cols } = S;
  const plotW = Math.round(cols * z);
  const plotH = Math.round(rows * z);
  const totalW = AXIS_PAD + plotW + 1;
  const totalH = AXIS_PAD + plotH + 1;

  el.canvas.width  = totalW;
  el.canvas.height = totalH;
  el.overlay.width  = totalW;
  el.overlay.height = totalH;

  // White background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, totalW, totalH);

  // Draw the dot matrix scaled into the plot area
  const tmp = document.createElement('canvas');
  tmp.width = cols; tmp.height = rows;
  tmp.getContext('2d').putImageData(S.dotImage, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, AXIS_PAD, AXIS_PAD, plotW, plotH);

  // ── Draw axes ────────────────────────────────────────────
  ctx.font = FONT;

  // Tick spacing
  const maxTicksX = Math.max(2, Math.floor(plotW / 50));
  const maxTicksY = Math.max(2, Math.floor(plotH / 40));
  const stepX = niceStep(cols, maxTicksX);
  const stepY = niceStep(rows, maxTicksY);

  // Border around plot
  ctx.strokeStyle = AXIS_COL;
  ctx.lineWidth = 1;
  ctx.strokeRect(AXIS_PAD + 0.5, AXIS_PAD + 0.5, plotW, plotH);

  // X ticks (top of plot)
  ctx.fillStyle = TICK_COL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (let pos = stepX; pos <= cols; pos += stepX) {
    const x = AXIS_PAD + Math.round(pos * z) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, AXIS_PAD);
    ctx.lineTo(x, AXIS_PAD - TICK_LEN);
    ctx.strokeStyle = TICK_COL;
    ctx.stroke();
    ctx.fillText(String(pos), x, AXIS_PAD - TICK_LEN - 1);
  }

  // Y ticks (left of plot)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let pos = stepY; pos <= rows; pos += stepY) {
    const y = AXIS_PAD + Math.round(pos * z) + 0.5;
    ctx.beginPath();
    ctx.moveTo(AXIS_PAD, y);
    ctx.lineTo(AXIS_PAD - TICK_LEN, y);
    ctx.strokeStyle = TICK_COL;
    ctx.stroke();
    ctx.fillText(String(pos), AXIS_PAD - TICK_LEN - 2, y);
  }

  // Axis titles
  ctx.fillStyle = AXIS_COL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText('Seq B', AXIS_PAD + plotW / 2, 2);
  ctx.save();
  ctx.translate(12, AXIS_PAD + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Seq A', 0, 0);
  ctx.restore();
}

// ── overlay (crosshair + trace) ──────────────────────────────
function canvasToCell(cx, cy) {
  return {
    col: Math.floor((cx - AXIS_PAD) / S.zoom),
    row: Math.floor((cy - AXIS_PAD) / S.zoom),
  };
}

function drawOverlay(row, col) {
  const w = el.overlay.width, h = el.overlay.height;
  oCtx.clearRect(0, 0, w, h);
  const z = S.zoom;
  const plotW = S.cols * z, plotH = S.rows * z;

  // Crosshair lines
  const cx = AXIS_PAD + (col + 0.5) * z;
  const cy = AXIS_PAD + (row + 0.5) * z;
  oCtx.strokeStyle = 'rgba(80,160,255,0.7)';
  oCtx.lineWidth = 1;
  oCtx.beginPath();
  oCtx.moveTo(AXIS_PAD, cy); oCtx.lineTo(AXIS_PAD + plotW, cy);
  oCtx.moveTo(cx, AXIS_PAD); oCtx.lineTo(cx, AXIS_PAD + plotH);
  oCtx.stroke();

  // Position markers on axis margin
  oCtx.fillStyle = 'rgba(80,160,255,0.95)';
  oCtx.font = 'bold 11px system-ui, sans-serif';
  oCtx.textAlign = 'center';
  oCtx.textBaseline = 'bottom';
  oCtx.fillText(String(col + 1), cx, AXIS_PAD - 1);
  oCtx.textAlign = 'right';
  oCtx.textBaseline = 'middle';
  oCtx.fillText(String(row + 1), AXIS_PAD - 2, cy);

  // Diagonal trace
  if (S.showTrace) {
    oCtx.fillStyle = 'rgba(100,230,160,0.85)';
    const pxSz = Math.max(1, Math.round(z));
    let r = row, c = col;
    while (r >= 0 && c >= 0 && normAt(r, c) >= S.threshold) {
      oCtx.fillRect(AXIS_PAD + c * z, AXIS_PAD + r * z, pxSz, pxSz); r--; c--;
    }
    r = row + 1; c = col + 1;
    while (r < S.rows && c < S.cols && normAt(r, c) >= S.threshold) {
      oCtx.fillRect(AXIS_PAD + c * z, AXIS_PAD + r * z, pxSz, pxSz); r++; c++;
    }
  }
}

// ── alignment panel ──────────────────────────────────────────
function updateAlignment(row, col) {
  const radius = 20;
  const aS = Math.max(0, row - radius), aE = Math.min(S.seqA.length, row + radius + 1);
  const bS = Math.max(0, col - radius), bE = Math.min(S.seqB.length, col + radius + 1);
  const aSlice = S.seqA.slice(aS, aE);
  const bSlice = S.seqB.slice(bS, bE);
  const guide = [];
  const len = Math.min(aSlice.length, bSlice.length);
  for (let i = 0; i < len; i++) guide.push(aSlice[i] === bSlice[i] ? '|' : ' ');
  el.aMeta.textContent = `A:${row+1}  B:${col+1}  score ${normAt(row, col).toFixed(3)}`;
  el.aPanel.textContent =
    `A ${String(aS+1).padStart(5)}  ${aSlice}\n` +
    `          ${guide.join('')}\n` +
    `B ${String(bS+1).padStart(5)}  ${bSlice}`;
}

// ── hover ────────────────────────────────────────────────────
function updateHover(row, col) {
  el.hover.textContent = `A:${row+1}/${S.rows}  B:${col+1}/${S.cols}  score=${normAt(row, col).toFixed(3)}`;
}
function clearHover() {
  el.hover.textContent = '\u00a0';
  el.aMeta.textContent = '\u00a0';
  el.aPanel.textContent = 'A: —\n   \nB: —';
  oCtx.clearRect(0, 0, el.overlay.width, el.overlay.height);
  S.lastRow = S.lastCol = -1;
}

// ── zoom / fit ───────────────────────────────────────────────
function applyZoom() {
  render();
  if (S.lastRow >= 0) drawOverlay(S.lastRow, S.lastCol);
}

function fitView() {
  if (!S.scores) return;
  const shell = el.viewport.parentElement;
  const vw = (shell.clientWidth  || 600) - AXIS_PAD - 20;
  const vh = (shell.clientHeight || 400) - AXIS_PAD - 20;
  if (S.cols === 0 || S.rows === 0) return;
  const z = Math.min(vw / S.cols, vh / S.rows, 24);
  S.zoom = Math.max(0.5, Math.round(z * 10) / 10);
  el.zoom.value = String(Math.min(24, Math.max(1, Math.round(S.zoom))));
  syncOutputs();
  applyZoom();
}

// ── main build ───────────────────────────────────────────────
async function buildPlot() {
  if (S.computing) return;
  const seqA = parseFasta(el.seqA.value);
  let seqB = parseFasta(el.seqB.value);
  if (!seqA || !seqB) { el.status.textContent = 'Provide two sequences.'; return; }
  if (el.revB.checked) seqB = revComp(seqB);

  S.seqA = seqA; S.seqB = seqB;
  S.windowSize = Number(el.window.value);
  S.threshold = Number(el.threshold.value) / 100;
  S.showTrace = el.trace.checked;

  el.status.textContent = `Computing ${seqA.length} × ${seqB.length}…`;
  S.computing = true;

  const t0 = performance.now();
  try {
    const result = await compute(seqA, seqB, S.windowSize, el.mode.value);
    S.scores   = new Int16Array(result.scores);
    S.rows     = result.rows;
    S.cols     = result.cols;
    S.scoreMin = result.min;
    S.scoreMax = result.max;
  } catch (err) {
    el.status.textContent = `Error: ${err.message}`;
    S.computing = false;
    return;
  }
  const ms = performance.now() - t0;
  S.computing = false;

  buildDotImage();
  fitView();
  clearHover();
  el.status.textContent = `${seqA.length} × ${seqB.length} in ${ms < 1000 ? ms.toFixed(0) + ' ms' : (ms/1000).toFixed(1) + ' s'}.`;
}

// ── slider updates ───────────────────────────────────────────
function syncOutputs() {
  el.windowOut.value   = el.window.value;
  el.thresholdOut.value = el.threshold.value;
  const z = S.zoom;
  el.zoomOut.value = (z < 1 ? z.toFixed(1) : z >= 10 ? Math.round(z) : z.toFixed(1)) + '×';
}

function fastRedraw() {
  if (!S.scores) return;
  S.threshold = Number(el.threshold.value) / 100;
  buildDotImage();
  render();
  if (S.lastRow >= 0) drawOverlay(S.lastRow, S.lastCol);
}

// ── exports ──────────────────────────────────────────────────
function download(name, href) {
  const a = document.createElement('a'); a.href = href; a.download = name; a.click();
}
function exportPng() {
  if (!S.scores) return;
  const c = document.createElement('canvas');
  c.width = el.canvas.width; c.height = el.canvas.height;
  const cx = c.getContext('2d');
  cx.drawImage(el.canvas, 0, 0);
  cx.drawImage(el.overlay, 0, 0);
  download('doter.png', c.toDataURL('image/png'));
}
function exportSvg() {
  if (!S.scores) return;
  const w = el.canvas.width, h = el.canvas.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(el.canvas, 0, 0);
  const dataUrl = c.toDataURL('image/png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<image href="${dataUrl}" width="${w}" height="${h}"/>` +
    `</svg>`;
  download('doter.svg', URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
}

// ── drag-drop ────────────────────────────────────────────────
async function loadFiles(files) {
  const ok = [...files].filter(f => f.type.startsWith('text') || /\.(fa|fasta|fna|fas|txt)$/i.test(f.name));
  if (!ok.length) { el.status.textContent = 'Drop FASTA / text files.'; return; }
  const texts = await Promise.all(ok.slice(0, 2).map(f => f.text()));
  if (texts[0]) el.seqA.value = texts[0];
  if (texts[1]) el.seqB.value = texts[1];
  el.status.textContent = `Loaded ${texts.length} file(s). Click Render.`;
}

function loadExample() {
  el.seqA.value = '>repeat_A\nTTTCGAGACCTGAAACTGTTTCGAGACCTGAAACTGTTTCGAGACCTGAAACTG';
  el.seqB.value = '>repeat_B\nTTTCGAGACCTGAAACTGATTCGAGACCGGAAACTGTTTCGAGACCTGAAACTG';
  buildPlot();
}

// ── event wiring ─────────────────────────────────────────────
el.render.addEventListener('click', buildPlot);
el.recalc.addEventListener('click', buildPlot);
el.example.addEventListener('click', loadExample);
el.fit.addEventListener('click', fitView);
el.pngBtn.addEventListener('click', exportPng);
el.svgBtn.addEventListener('click', exportSvg);

el.threshold.addEventListener('input', () => { syncOutputs(); fastRedraw(); });

el.zoom.addEventListener('input', () => {
  S.zoom = Number(el.zoom.value);
  syncOutputs();
  applyZoom();
});

for (const inp of [el.window, el.mode, el.revB]) {
  inp.addEventListener('input', syncOutputs);
  inp.addEventListener('change', () => {
    el.status.textContent = 'Parameter changed — click Render to recompute.';
  });
}

el.trace.addEventListener('change', () => {
  S.showTrace = el.trace.checked;
  if (S.lastRow >= 0) drawOverlay(S.lastRow, S.lastCol);
});

// ── mouse interaction ────────────────────────────────────────
let hoverRaf = 0;

el.overlay.addEventListener('mousemove', (e) => {
  if (!S.scores) return;
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    const rect = el.overlay.getBoundingClientRect();
    const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);
    if (row < 0 || col < 0 || row >= S.rows || col >= S.cols) return;
    if (row === S.lastRow && col === S.lastCol) return;
    S.lastRow = row; S.lastCol = col;
    drawOverlay(row, col);
    updateHover(row, col);
    updateAlignment(row, col);
  });
});

el.overlay.addEventListener('mouseleave', () => {
  if (hoverRaf) { cancelAnimationFrame(hoverRaf); hoverRaf = 0; }
  clearHover();
});

// Mouse wheel zoom (centered on cursor)
el.viewport.addEventListener('wheel', (e) => {
  if (!S.scores) return;
  e.preventDefault();

  const oldZ = S.zoom;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  S.zoom = Math.max(0.5, Math.min(24, Math.round(oldZ * factor * 10) / 10));

  const rect = el.viewport.getBoundingClientRect();
  const mx = e.clientX - rect.left + el.viewport.scrollLeft;
  const my = e.clientY - rect.top  + el.viewport.scrollTop;
  const ratio = S.zoom / oldZ;

  el.zoom.value = String(Math.min(24, Math.max(1, Math.round(S.zoom))));
  syncOutputs();
  applyZoom();

  el.viewport.scrollLeft = mx * ratio - (e.clientX - rect.left);
  el.viewport.scrollTop  = my * ratio - (e.clientY - rect.top);
}, { passive: false });

// Pan by dragging
let pan = null;
el.viewport.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  pan = { x: e.clientX, y: e.clientY, sl: el.viewport.scrollLeft, st: el.viewport.scrollTop };
  el.viewport.classList.add('panning');
});
window.addEventListener('mousemove', (e) => {
  if (!pan) return;
  el.viewport.scrollLeft = pan.sl - (e.clientX - pan.x);
  el.viewport.scrollTop  = pan.st - (e.clientY - pan.y);
});
window.addEventListener('mouseup', () => { pan = null; el.viewport.classList.remove('panning'); });

// Drop zone
for (const ev of ['dragenter','dragover']) el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.add('active'); });
for (const ev of ['dragleave','drop'])     el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.remove('active'); });
el.drop.addEventListener('drop', e => loadFiles(e.dataTransfer.files));

// ── boot ─────────────────────────────────────────────────────
syncOutputs();
clearHover();
buildPlot().catch(e => {
  console.error('Boot buildPlot failed:', e);
  el.status.textContent = 'Boot error: ' + e.message;
});
