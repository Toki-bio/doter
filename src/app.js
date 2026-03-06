const state = {
  seqA: '',
  seqB: '',
  scoreGrid: null,
  normalizedGrid: null,
  pixelSize: 4,
  zoom: 4,
  threshold: 0.55,
  windowSize: 9,
  showTrace: true,
  lastHover: null,
  worker: null,
  pan: { active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 },
};

const els = {
  seqA: document.querySelector('#seqA'),
  seqB: document.querySelector('#seqB'),
  renderBtn: document.querySelector('#renderBtn'),
  recalcBtn: document.querySelector('#recalcBtn'),
  exampleBtn: document.querySelector('#exampleBtn'),
  windowSize: document.querySelector('#windowSize'),
  threshold: document.querySelector('#threshold'),
  pixelSize: document.querySelector('#pixelSize'),
  zoomLevel: document.querySelector('#zoomLevel'),
  windowSizeValue: document.querySelector('#windowSizeValue'),
  thresholdValue: document.querySelector('#thresholdValue'),
  pixelSizeValue: document.querySelector('#pixelSizeValue'),
  zoomLevelValue: document.querySelector('#zoomLevelValue'),
  scoreMode: document.querySelector('#scoreMode'),
  reverseB: document.querySelector('#reverseB'),
  showTrace: document.querySelector('#showTrace'),
  fitViewBtn: document.querySelector('#fitViewBtn'),
  exportPngBtn: document.querySelector('#exportPngBtn'),
  exportSvgBtn: document.querySelector('#exportSvgBtn'),
  statusLine: document.querySelector('#statusLine'),
  hoverInfo: document.querySelector('#hoverInfo'),
  alignmentMeta: document.querySelector('#alignmentMeta'),
  alignmentPanel: document.querySelector('#alignmentPanel'),
  dropZone: document.querySelector('#dropZone'),
  canvasViewport: document.querySelector('#canvasViewport'),
  canvasStage: document.querySelector('#canvasStage'),
  plotCanvas: document.querySelector('#plotCanvas'),
  overlayCanvas: document.querySelector('#overlayCanvas'),
};

const plotCtx = els.plotCanvas.getContext('2d', { alpha: false });
const overlayCtx = els.overlayCanvas.getContext('2d');

function parseFasta(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('>'))
    .join('')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function reverseComplement(seq) {
  const map = { A: 'T', C: 'G', G: 'C', T: 'A', U: 'A', N: 'N' };
  return [...seq].reverse().map((base) => map[base] ?? 'N').join('');
}

function ensureWorker() {
  if (state.worker) return state.worker;
  state.worker = new Worker('./src/worker.js', { type: 'module' });
  return state.worker;
}

function computeDotplot(seqA, seqB, windowSize, mode) {
  const worker = ensureWorker();
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      const { normalized, raw, rows, cols, min, max, error } = event.data;
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve({
        raw: raw.map((row) => Float32Array.from(row)),
        normalized: normalized.map((row) => Float32Array.from(row)),
        rows,
        cols,
        min,
        max,
      });
    };
    const onError = (error) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(error);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ seqA, seqB, windowSize, mode });
  });
}

function resizeCanvases(cols, rows, pixelSize) {
  const width = cols * pixelSize;
  const height = rows * pixelSize;
  for (const canvas of [els.plotCanvas, els.overlayCanvas]) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  els.canvasStage.style.width = `${width}px`;
  els.canvasStage.style.height = `${height}px`;
}

function applyZoom() {
  els.canvasStage.style.transform = `scale(${state.zoom})`;
}

function renderPlot() {
  const { normalized, rows, cols } = state.normalizedGrid;
  resizeCanvases(cols, rows, state.pixelSize);
  const image = plotCtx.createImageData(cols, rows);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = (y * cols + x) * 4;
      const value = normalized[y][x] >= state.threshold ? 0 : 255 - Math.round(normalized[y][x] * 255);
      image.data[idx] = value;
      image.data[idx + 1] = value;
      image.data[idx + 2] = value;
      image.data[idx + 3] = 255;
    }
  }

  const temp = document.createElement('canvas');
  temp.width = cols;
  temp.height = rows;
  temp.getContext('2d').putImageData(image, 0, 0);
  plotCtx.save();
  plotCtx.imageSmoothingEnabled = false;
  plotCtx.clearRect(0, 0, els.plotCanvas.width, els.plotCanvas.height);
  plotCtx.drawImage(temp, 0, 0, cols, rows, 0, 0, els.plotCanvas.width, els.plotCanvas.height);
  plotCtx.restore();
}

function computeTrace(row, col) {
  const trace = [{ row, col }];
  let r = row - 1;
  let c = col - 1;
  while (r >= 0 && c >= 0 && state.normalizedGrid.normalized[r][c] >= state.threshold) {
    trace.unshift({ row: r, col: c });
    r -= 1;
    c -= 1;
  }
  r = row + 1;
  c = col + 1;
  while (r < state.normalizedGrid.rows && c < state.normalizedGrid.cols && state.normalizedGrid.normalized[r][c] >= state.threshold) {
    trace.push({ row: r, col: c });
    r += 1;
    c += 1;
  }
  return trace;
}

function computeLocalAlignment(aSlice, bSlice) {
  const matchScore = 2;
  const mismatchScore = -1;
  const gapScore = -2;
  const rows = aSlice.length + 1;
  const cols = bSlice.length + 1;
  const score = Array.from({ length: rows }, () => new Int16Array(cols));
  const pointer = Array.from({ length: rows }, () => new Uint8Array(cols));
  let best = { value: 0, row: 0, col: 0 };

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const diag = score[i - 1][j - 1] + (aSlice[i - 1] === bSlice[j - 1] ? matchScore : mismatchScore);
      const up = score[i - 1][j] + gapScore;
      const left = score[i][j - 1] + gapScore;
      const cell = Math.max(0, diag, up, left);
      score[i][j] = cell;
      if (cell === 0) pointer[i][j] = 0;
      else if (cell === diag) pointer[i][j] = 1;
      else if (cell === up) pointer[i][j] = 2;
      else pointer[i][j] = 3;
      if (cell > best.value) {
        best = { value: cell, row: i, col: j };
      }
    }
  }

  const alignedA = [];
  const alignedB = [];
  const guide = [];
  let i = best.row;
  let j = best.col;
  while (i > 0 && j > 0 && score[i][j] > 0) {
    const move = pointer[i][j];
    if (move === 1) {
      const aChar = aSlice[i - 1];
      const bChar = bSlice[j - 1];
      alignedA.push(aChar);
      alignedB.push(bChar);
      guide.push(aChar === bChar ? '|' : '.');
      i -= 1;
      j -= 1;
    } else if (move === 2) {
      alignedA.push(aSlice[i - 1]);
      alignedB.push('-');
      guide.push(' ');
      i -= 1;
    } else if (move === 3) {
      alignedA.push('-');
      alignedB.push(bSlice[j - 1]);
      guide.push(' ');
      j -= 1;
    } else {
      break;
    }
  }

  return {
    score: best.value,
    startA: i,
    startB: j,
    alignedA: alignedA.reverse().join(''),
    alignedB: alignedB.reverse().join(''),
    guide: guide.reverse().join(''),
  };
}

function buildAlignmentPanel(trace, row, col) {
  const radius = Math.max(12, Math.floor(state.windowSize * 1.5));
  const aStart = Math.max(0, row - radius);
  const aEnd = Math.min(state.seqA.length, row + radius + 1);
  const bStart = Math.max(0, col - radius);
  const bEnd = Math.min(state.seqB.length, col + radius + 1);
  const aSlice = state.seqA.slice(aStart, aEnd);
  const bSlice = state.seqB.slice(bStart, bEnd);
  const alignment = computeLocalAlignment(aSlice, bSlice);
  const traceSpan = trace.length ? `${trace[0].row + 1}:${trace[0].col + 1} → ${trace.at(-1).row + 1}:${trace.at(-1).col + 1}` : 'single point';
  els.alignmentMeta.textContent = `Cursor A:${row + 1} B:${col + 1} · trace ${trace.length} cells · span ${traceSpan} · local score ${alignment.score}`;
  els.alignmentPanel.textContent = `A ${String(aStart + alignment.startA + 1).padStart(5, ' ')}  ${alignment.alignedA}\n          ${alignment.guide}\nB ${String(bStart + alignment.startB + 1).padStart(5, ' ')}  ${alignment.alignedB}`;
}

function drawOverlay(row, col) {
  overlayCtx.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
  state.lastHover = { row, col };
  const px = col * state.pixelSize;
  const py = row * state.pixelSize;

  overlayCtx.strokeStyle = 'rgba(120, 196, 255, 0.95)';
  overlayCtx.lineWidth = 1;
  overlayCtx.beginPath();
  overlayCtx.moveTo(0, py + state.pixelSize / 2);
  overlayCtx.lineTo(els.overlayCanvas.width, py + state.pixelSize / 2);
  overlayCtx.moveTo(px + state.pixelSize / 2, 0);
  overlayCtx.lineTo(px + state.pixelSize / 2, els.overlayCanvas.height);
  overlayCtx.stroke();

  if (state.showTrace) {
    const trace = computeTrace(row, col);
    overlayCtx.fillStyle = 'rgba(142, 255, 193, 0.9)';
    for (const point of trace) {
      overlayCtx.fillRect(
        point.col * state.pixelSize,
        point.row * state.pixelSize,
        state.pixelSize,
        state.pixelSize,
      );
    }
    buildAlignmentPanel(trace, row, col);
  } else {
    buildAlignmentPanel([], row, col);
  }

  const snippetA = state.seqA.slice(Math.max(0, row - 12), Math.min(state.seqA.length, row + 13));
  const snippetB = state.seqB.slice(Math.max(0, col - 12), Math.min(state.seqB.length, col + 13));
  const score = state.normalizedGrid.normalized[row][col];
  els.hoverInfo.textContent = `A:${row + 1}/${state.seqA.length} B:${col + 1}/${state.seqB.length} score=${score.toFixed(3)} | ${snippetA} :: ${snippetB}`;
}

async function buildPlot() {
  const seqA = parseFasta(els.seqA.value);
  let seqB = parseFasta(els.seqB.value);
  if (!seqA || !seqB) {
    els.statusLine.textContent = 'Please provide two sequences.';
    return;
  }

  if (els.reverseB.checked) {
    seqB = reverseComplement(seqB);
  }

  state.seqA = seqA;
  state.seqB = seqB;
  state.windowSize = Number(els.windowSize.value);
  state.threshold = Number(els.threshold.value) / 100;
  state.pixelSize = Number(els.pixelSize.value);
  state.zoom = Number(els.zoomLevel.value);
  state.showTrace = els.showTrace.checked;

  const start = performance.now();
  els.statusLine.textContent = `Computing ${seqA.length} × ${seqB.length} score image…`;
  try {
    state.normalizedGrid = await computeDotplot(seqA, seqB, state.windowSize, els.scoreMode.value);
  } catch (error) {
    els.statusLine.textContent = `Failed to compute matrix: ${error.message}`;
    return;
  }
  const ms = performance.now() - start;
  renderPlot();
  applyZoom();
  overlayCtx.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
  els.alignmentMeta.textContent = 'Hover over the matrix to inspect the diagonal neighborhood.';
  els.alignmentPanel.textContent = `A: —\n   \nB: —`;
  els.statusLine.textContent = `Computed ${seqA.length} × ${seqB.length} windowed scores in ${ms.toFixed(1)} ms. Threshold-only changes redraw instantly; window/mode changes recalculate.`;
}

function updateOutputs() {
  els.windowSizeValue.value = els.windowSize.value;
  els.thresholdValue.value = els.threshold.value;
  els.pixelSizeValue.value = els.pixelSize.value;
  els.zoomLevelValue.value = `${els.zoomLevel.value}×`;
}

function fitView() {
  if (!state.normalizedGrid) return;
  const availableWidth = els.canvasViewport.clientWidth || 1;
  const availableHeight = els.canvasViewport.clientHeight || 1;
  const plotWidth = state.normalizedGrid.cols * state.pixelSize;
  const plotHeight = state.normalizedGrid.rows * state.pixelSize;
  const scale = Math.max(1, Math.floor(Math.min(availableWidth / plotWidth, availableHeight / plotHeight) * 10) / 10);
  state.zoom = scale;
  els.zoomLevel.value = String(Math.min(24, Math.max(1, Math.round(scale))));
  updateOutputs();
  applyZoom();
}

function triggerDownload(name, href) {
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
}

function exportPng() {
  if (!state.normalizedGrid) return;
  const merged = document.createElement('canvas');
  merged.width = els.plotCanvas.width;
  merged.height = els.plotCanvas.height;
  const ctx = merged.getContext('2d');
  ctx.drawImage(els.plotCanvas, 0, 0);
  if (state.lastHover) {
    ctx.drawImage(els.overlayCanvas, 0, 0);
  }
  triggerDownload('doter-plot.png', merged.toDataURL('image/png'));
}

function exportSvg() {
  if (!state.normalizedGrid) return;
  const { normalized, rows, cols } = state.normalizedGrid;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cols}" height="${rows}" viewBox="0 0 ${cols} ${rows}" shape-rendering="crispEdges">`,
    '<rect width="100%" height="100%" fill="white"/>',
  ];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const value = normalized[y][x] >= state.threshold ? 0 : 255 - Math.round(normalized[y][x] * 255);
      const hex = value.toString(16).padStart(2, '0');
      parts.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="#${hex}${hex}${hex}"/>`);
    }
  }
  if (state.lastHover) {
    parts.push(`<line x1="0" x2="${cols}" y1="${state.lastHover.row + 0.5}" y2="${state.lastHover.row + 0.5}" stroke="#78c4ff" stroke-width="0.15"/>`);
    parts.push(`<line y1="0" y2="${rows}" x1="${state.lastHover.col + 0.5}" x2="${state.lastHover.col + 0.5}" stroke="#78c4ff" stroke-width="0.15"/>`);
  }
  parts.push('</svg>');
  const blob = new Blob([parts.join('')], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload('doter-plot.svg', URL.createObjectURL(blob));
}

async function readSequenceFiles(files) {
  const fastaFiles = [...files].filter((file) => file.type.startsWith('text') || /\.(fa|fasta|fna|fas|txt)$/i.test(file.name));
  if (!fastaFiles.length) {
    els.statusLine.textContent = 'Drop FASTA or plain-text sequence files.';
    return;
  }
  const contents = await Promise.all(fastaFiles.slice(0, 2).map((file) => file.text()));
  if (contents[0]) els.seqA.value = contents[0];
  if (contents[1]) els.seqB.value = contents[1];
  els.statusLine.textContent = `Loaded ${contents.length} sequence file${contents.length > 1 ? 's' : ''}. Click Render plot or Recalculate scores.`;
}

function updateFastRender() {
  if (!state.normalizedGrid) return;
  state.threshold = Number(els.threshold.value) / 100;
  state.pixelSize = Number(els.pixelSize.value);
  state.zoom = Number(els.zoomLevel.value);
  renderPlot();
  applyZoom();
  if (state.lastHover) {
    drawOverlay(state.lastHover.row, state.lastHover.col);
  }
  els.statusLine.textContent = 'Redrew current score image with updated threshold / zoom / pixel size.';
}

function loadExample() {
  els.seqA.value = `>repeat_A\nTTTCGAGACCTGAAACTGTTTCGAGACCTGAAACTGTTTCGAGACCTGAAACTG`;
  els.seqB.value = `>repeat_B\nTTTCGAGACCTGAAACTGATTCGAGACCGGAAACTGTTTCGAGACCTGAAACTG`;
  buildPlot();
}

for (const input of [els.threshold, els.pixelSize, els.zoomLevel]) {
  input.addEventListener('input', () => {
    updateOutputs();
    updateFastRender();
  });
}

for (const input of [els.windowSize, els.scoreMode, els.reverseB]) {
  input.addEventListener('input', updateOutputs);
  input.addEventListener('change', () => {
    els.statusLine.textContent = 'Window/mode/orientation changed. Recalculate scores to update the matrix.';
  });
}

els.showTrace.addEventListener('change', () => {
  state.showTrace = els.showTrace.checked;
  if (state.lastHover) {
    drawOverlay(state.lastHover.row, state.lastHover.col);
  }
});

els.renderBtn.addEventListener('click', buildPlot);
els.recalcBtn.addEventListener('click', buildPlot);
els.exampleBtn.addEventListener('click', loadExample);
els.fitViewBtn.addEventListener('click', fitView);
els.exportPngBtn.addEventListener('click', exportPng);
els.exportSvgBtn.addEventListener('click', exportSvg);

els.overlayCanvas.addEventListener('mousemove', (event) => {
  if (!state.normalizedGrid) return;
  const rect = els.overlayCanvas.getBoundingClientRect();
  const scale = state.zoom || 1;
  const col = Math.floor((event.clientX - rect.left) / (state.pixelSize * scale));
  const row = Math.floor((event.clientY - rect.top) / (state.pixelSize * scale));
  if (
    row < 0 ||
    col < 0 ||
    row >= state.normalizedGrid.rows ||
    col >= state.normalizedGrid.cols
  ) {
    return;
  }
  drawOverlay(row, col);
});

els.overlayCanvas.addEventListener('mouseleave', () => {
  overlayCtx.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
  els.hoverInfo.textContent = 'Hover over the plot to inspect coordinates.';
  els.alignmentMeta.textContent = 'Hover over the matrix to inspect the diagonal neighborhood.';
  els.alignmentPanel.textContent = `A: —\n   \nB: —`;
});

els.canvasViewport.addEventListener('mousedown', (event) => {
  state.pan.active = true;
  state.pan.startX = event.clientX;
  state.pan.startY = event.clientY;
  state.pan.scrollLeft = els.canvasViewport.scrollLeft;
  state.pan.scrollTop = els.canvasViewport.scrollTop;
  els.canvasViewport.classList.add('panning');
});

window.addEventListener('mouseup', () => {
  state.pan.active = false;
  els.canvasViewport.classList.remove('panning');
});

els.canvasViewport.addEventListener('mousemove', (event) => {
  if (!state.pan.active) return;
  els.canvasViewport.scrollLeft = state.pan.scrollLeft - (event.clientX - state.pan.startX);
  els.canvasViewport.scrollTop = state.pan.scrollTop - (event.clientY - state.pan.startY);
});

els.canvasViewport.addEventListener('wheel', (event) => {
  if (!state.normalizedGrid || !event.ctrlKey) return;
  event.preventDefault();
  const next = Math.min(24, Math.max(1, state.zoom + (event.deltaY < 0 ? 1 : -1)));
  state.zoom = next;
  els.zoomLevel.value = String(next);
  updateOutputs();
  applyZoom();
}, { passive: false });

for (const eventName of ['dragenter', 'dragover']) {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add('active');
  });
}

for (const eventName of ['dragleave', 'drop']) {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('active');
  });
}

els.dropZone.addEventListener('drop', async (event) => {
  await readSequenceFiles(event.dataTransfer.files);
});

updateOutputs();
buildPlot();
