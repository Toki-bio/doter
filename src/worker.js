/* ── Doter: worker ─────────────────────────────────────────────
   Diagonal prefix-sum scoring.  O(N·M) total, no inner window loop.
   Posts back a flat Uint8Array grayscale image (1 byte per cell)
   plus a flat Float32Array of normalised scores for hover lookup. */

self.addEventListener('message', (event) => {
  try {
    const { seqA, seqB, windowSize, mode } = event.data;
    const N = seqA.length;
    const M = seqB.length;
    const half = (windowSize - 1) >> 1;

    const scores = new Float32Array(N * M);
    let globalMin = Infinity;
    let globalMax = -Infinity;

    // Process each diagonal.  Diagonal d = j - i, range -(N-1) .. +(M-1).
    for (let d = -(N - 1); d <= M - 1; d += 1) {
      const iStart = Math.max(0, -d);
      const jStart = iStart + d;
      const len = Math.min(N - iStart, M - jStart);
      if (len <= 0) continue;

      // Prefix sum along this diagonal
      const prefix = new Float32Array(len + 1);
      for (let k = 0; k < len; k += 1) {
        const a = seqA.charCodeAt(iStart + k);
        const b = seqB.charCodeAt(jStart + k);
        prefix[k + 1] = prefix[k] + (a === b ? 1 : (mode === 'dna-simple' ? -1 : 0));
      }

      // Windowed score for each cell on this diagonal
      for (let k = 0; k < len; k += 1) {
        const lo = Math.max(0, k - half);
        const hi = Math.min(len, k + half + 1);
        const score = prefix[hi] - prefix[lo];
        const idx = (iStart + k) * M + (jStart + k);
        scores[idx] = score;
        if (score < globalMin) globalMin = score;
        if (score > globalMax) globalMax = score;
      }
    }

    // Normalise scores to 0..1 and build grayscale pixels
    const range = globalMax - globalMin || 1;
    const norm = new Float32Array(N * M);
    const pixels = new Uint8Array(N * M);
    for (let i = 0; i < N * M; i += 1) {
      const n = (scores[i] - globalMin) / range;
      norm[i] = n;
      pixels[i] = 255 - Math.round(n * 255);   // dark = match
    }

    self.postMessage(
      { pixels, norm, rows: N, cols: M, min: globalMin, max: globalMax },
      [pixels.buffer, norm.buffer],
    );
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
});
