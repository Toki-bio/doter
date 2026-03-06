/* ── Doter: main app ───────────────────────────────────────────
   Clean rewrite.  Canvas is always 1 pixel = 1 cell.
   Zoom is pure CSS transform.  Hover never causes layout reflow. */

// ── state ────────────────────────────────────────────────────
const S = {
  seqA: '', seqB: '',
  scores: null, rows: 0, cols: 0,
  scoreMin: 0, scoreMax: 1,
  threshold: 0.55, windowSize: 9, zoom: 1,
  showTrace: true, lastRow: -1, lastCol: -1,
  worker: null, computing: false,
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
  stage:       $('#canvasStage'),
  plot:        $('#plotCanvas'),
  overlay:     $('#overlayCanvas'),
};
const plotCtx = el.plot.getContext('2d', { alpha: false });
const overCtx = el.overlay.getContext('2d');

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
      if (e.data.error) { rej(new Error(e.data.error)); return; }
      res(e.data);
    };
    const no = (e) => { w.removeEventListener('message', ok); w.removeEventListener('error', no); rej(e); };
    w.addEventListener('message', ok);
    w.addEventListener('error', no);
    w.postMessage({ seqA, seqB, windowSize, mode });
  });
}

// ── rendering ────────────────────────────────────────────────
function sizeCanvas(rows, cols) {
  // Canvas = exactly rows × cols pixels.  Zoom is CSS only.
  for (const c of [el.plot, el.overlay]) {
    c.width = cols; c.height = rows;
  }
}

function paintImage() {
  const { scores, rows, cols } = S;
  if (!scores) return;
  sizeCanvas(rows, cols);
  const img = plotCtx.createImageData(cols, rows);
  const d = img.data;
  const range = S.scoreMax - S.scoreMin || 1;
  const thr = S.threshold;   // 0..1 normalised
  const total = rows * cols;
  for (let i = 0, j = 0; i < total; i++, j += 4) {
    // normalise score to 0..1
    const n = (scores[i] - S.scoreMin) / range;
    // Dotter convention: white background, dark where score ≥ threshold
    const v = n >= thr ? Math.round((1 - n) * 255) : 255;
    d[j] = v; d[j+1] = v; d[j+2] = v; d[j+3] = 255;
  }
  plotCtx.putImageData(img, 0, 0);
}

function applyZoom() {
  const z = S.zoom;
  el.stage.style.transform = `scale(${z})`;
  // Set layout size to scaled dimensions so scrollbars work correctly
  el.stage.style.width  = `${S.cols * z}px`;
  el.stage.style.height = `${S.rows * z}px`;
}

function fitView() {
  if (!S.scores) return;
  // Use the shell (the resizable container) for available space
  const shell = el.viewport.parentElement;
  const vw = shell.clientWidth  || el.viewport.clientWidth  || 600;
  const vh = shell.clientHeight || el.viewport.clientHeight || 400;
  if (S.cols === 0 || S.rows === 0) return;
  // Fit the plot into the available space, cap at 24×
  const z = Math.min(vw / S.cols, vh / S.rows, 24);
  S.zoom = Math.max(0.1, Math.round(z * 10) / 10);
  el.zoom.value = String(Math.min(24, Math.max(1, Math.round(S.zoom))));
  syncOutputs();
  applyZoom();
}

// ── overlay (crosshair + trace) ──────────────────────────────
function normAt(r, c) {
  const range = S.scoreMax - S.scoreMin || 1;
  return (S.scores[r * S.cols + c] - S.scoreMin) / range;
}

function drawOverlay(row, col) {
  const ctx = overCtx;
  const w = S.cols, h = S.rows;
  ctx.clearRect(0, 0, w, h);

  // crosshair
  ctx.strokeStyle = 'rgba(120,196,255,0.85)';
  ctx.lineWidth = 1 / S.zoom;        // stays thin at any zoom
  ctx.beginPath();
  ctx.moveTo(0, row + 0.5); ctx.lineTo(w, row + 0.5);
  ctx.moveTo(col + 0.5, 0); ctx.lineTo(col + 0.5, h);
  ctx.stroke();

  // diagonal trace
  if (S.showTrace) {
    ctx.fillStyle = 'rgba(142,255,193,0.8)';
    let r = row, c = col;
    while (r >= 0 && c >= 0 && normAt(r, c) >= S.threshold) { ctx.fillRect(c, r, 1, 1); r--; c--; }
    r = row + 1; c = col + 1;
    while (r < h && c < w && normAt(r, c) >= S.threshold) { ctx.fillRect(c, r, 1, 1); r++; c++; }
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

// ── hover info (fixed height, no reflow) ─────────────────────
function updateHover(row, col) {
  const sc = normAt(row, col);
  el.hover.textContent = `A:${row+1}/${S.rows}  B:${col+1}/${S.cols}  score=${sc.toFixed(3)}`;
}
function clearHover() {
  el.hover.textContent = '\u00a0';   // non-breaking space keeps height
  el.aMeta.textContent = '\u00a0';
  el.aPanel.textContent = 'A: —\n   \nB: —';
  overCtx.clearRect(0, 0, S.cols, S.rows);
  S.lastRow = S.lastCol = -1;
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
  S.zoom = Number(el.zoom.value);
  S.showTrace = el.trace.checked;

  const total = seqA.length * seqB.length;
  el.status.textContent = `Computing ${seqA.length} × ${seqB.length} (${(total/1e6).toFixed(1)}M cells)…`;
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

  paintImage();
  fitView();
  clearHover();
  el.status.textContent = `${seqA.length} × ${seqB.length} in ${ms < 1000 ? ms.toFixed(0) + ' ms' : (ms/1000).toFixed(1) + ' s'}.`;
}

// ── slider updates (no recompute) ────────────────────────────
function syncOutputs() {
  el.windowOut.value   = el.window.value;
  el.thresholdOut.value = el.threshold.value;
  el.zoomOut.value     = (S.zoom < 1 ? S.zoom.toFixed(1) : S.zoom >= 10 ? Math.round(S.zoom) : S.zoom.toFixed(1)) + '×';
}

function fastRedraw() {
  if (!S.scores) return;
  S.threshold = Number(el.threshold.value) / 100;
  paintImage();
  if (S.lastRow >= 0) drawOverlay(S.lastRow, S.lastCol);
}

// ── exports ──────────────────────────────────────────────────
function download(name, href) {
  const a = document.createElement('a'); a.href = href; a.download = name; a.click();
}
function exportPng() {
  if (!S.scores) return;
  // Composite plot + overlay at 1:1
  const c = document.createElement('canvas'); c.width = S.cols; c.height = S.rows;
  const ctx = c.getContext('2d');
  ctx.drawImage(el.plot, 0, 0);
  ctx.drawImage(el.overlay, 0, 0);
  download('doter.png', c.toDataURL('image/png'));
}
function exportSvg() {
  if (!S.scores) return;
  // Encode the plot canvas as a PNG data-url embedded in an SVG for vector wrapper
  const c = document.createElement('canvas'); c.width = S.cols; c.height = S.rows;
  c.getContext('2d').drawImage(el.plot, 0, 0);
  const dataUrl = c.toDataURL('image/png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S.cols}" height="${S.rows}">` +
    `<image href="${dataUrl}" width="${S.cols}" height="${S.rows}" image-rendering="pixelated"/>` +
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

// ── example ──────────────────────────────────────────────────
function loadExample() {
  el.seqA.value = '>repeat_A\nTTTCGAGACCTGAAACTGTTTCGAGACCTGAAACTGTTTCGAGACCTGAAACTG';
  el.seqB.value = '>repeat_B\nTTTCGAGACCTGAAACTGATTCGAGACCGGAAACTGTTTCGAGACCTGAAACTG';
  buildPlot();
}

// ── event wiring ─────────────────────────────────────────────

// Render / recalc
el.render.addEventListener('click', buildPlot);
el.recalc.addEventListener('click', buildPlot);
el.example.addEventListener('click', loadExample);
el.fit.addEventListener('click', fitView);
el.pngBtn.addEventListener('click', exportPng);
el.svgBtn.addEventListener('click', exportSvg);

// Threshold → instant repaint (no recompute)
el.threshold.addEventListener('input', () => { syncOutputs(); fastRedraw(); });

// Zoom → CSS only
el.zoom.addEventListener('input', () => {
  syncOutputs();
  S.zoom = Number(el.zoom.value);
  applyZoom();
});

// Window / mode / revcomp → just update label, require explicit recompute
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

// ── mouse interaction on overlay canvas ──────────────────────
let hoverRaf = 0;

el.overlay.addEventListener('mousemove', (e) => {
  if (!S.scores) return;
  if (hoverRaf) return;           // skip until previous frame is done
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    const rect = el.overlay.getBoundingClientRect();
    const z = S.zoom;
    const col = Math.floor((e.clientX - rect.left) / z);
    const row = Math.floor((e.clientY - rect.top) / z);
    if (row < 0 || col < 0 || row >= S.rows || col >= S.cols) return;
    if (row === S.lastRow && col === S.lastCol) return;  // no change
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
  // Finer steps: ±10% per tick
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const next = Math.min(24, Math.max(0.1, oldZ * factor));
  // Round to 1 decimal
  S.zoom = Math.round(next * 10) / 10;

  // Zoom toward mouse cursor
  const rect = el.viewport.getBoundingClientRect();
  const mx = e.clientX - rect.left + el.viewport.scrollLeft;
  const my = e.clientY - rect.top  + el.viewport.scrollTop;
  const ratio = S.zoom / oldZ;
  el.viewport.scrollLeft = mx * ratio - (e.clientX - rect.left);
  el.viewport.scrollTop  = my * ratio - (e.clientY - rect.top);

  el.zoom.value = String(Math.min(24, Math.max(1, Math.round(S.zoom))));
  syncOutputs();
  applyZoom();
}, { passive: false });

// Pan by dragging
let pan = null;
el.viewport.addEventListener('mousedown', (e) => {
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
