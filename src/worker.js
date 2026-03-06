/* ── Doter: worker ─────────────────────────────────────────────
   Diagonal prefix-sum scoring.  O(N·M) total, no inner window loop.
   Returns raw Int16 scores — rendering is done on the main thread
   so threshold changes don't need a recompute.                    */

self.addEventListener('message', (event) => {
  try {
    const { seqA, seqB, windowSize, mode } = event.data;
    const N = seqA.length;
    const M = seqB.length;
    const half = (windowSize - 1) >> 1;
    const mismatch = mode === 'dna-simple' ? -1 : 0;

    // Pre-encode sequences to Uint8Arrays for fast charCode comparison
    const aEnc = new Uint8Array(N);
    const bEnc = new Uint8Array(M);
    for (let i = 0; i < N; i++) aEnc[i] = seqA.charCodeAt(i);
    for (let j = 0; j < M; j++) bEnc[j] = seqB.charCodeAt(j);

    // Raw windowed scores — Int16 is enough (window ≤61 → scores −61..+61)
    const scores = new Int16Array(N * M);
    // Single reusable prefix buffer — max diagonal length = max(N,M)
    const maxDiagLen = Math.max(N, M);
    const prefix = new Int32Array(maxDiagLen + 1);

    let globalMin = 0x7FFF;
    let globalMax = -0x8000;

    // Process each diagonal d = j - i
    const diagCount = N + M - 1;
    for (let dd = 0; dd < diagCount; dd++) {
      const d = dd - (N - 1);          // range -(N-1) .. +(M-1)
      const iStart = d < 0 ? -d : 0;
      const jStart = d < 0 ? 0 : d;
      const len = Math.min(N - iStart, M - jStart);

      // Build prefix sum along this diagonal (reusing buffer)
      prefix[0] = 0;
      for (let k = 0; k < len; k++) {
        prefix[k + 1] = prefix[k] + (aEnc[iStart + k] === bEnc[jStart + k] ? 1 : mismatch);
      }

      // Windowed score for each cell
      for (let k = 0; k < len; k++) {
        const lo = k - half;
        const hi = k + half + 1;
        const s = prefix[hi < len ? hi : len] - prefix[lo > 0 ? lo : 0];
        scores[(iStart + k) * M + (jStart + k)] = s;
        if (s < globalMin) globalMin = s;
        if (s > globalMax) globalMax = s;
      }
    }

    self.postMessage(
      { scores, rows: N, cols: M, min: globalMin, max: globalMax },
      [scores.buffer],
    );
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
});
