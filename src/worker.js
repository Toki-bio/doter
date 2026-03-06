function scorePair(a, b, mode) {
  if (mode === 'dna-simple') {
    return a === b ? 1 : -1;
  }
  return a === b ? 1 : 0;
}

function computeDotplot(seqA, seqB, windowSize, mode) {
  const rows = seqA.length;
  const cols = seqB.length;
  const normalized = Array.from({ length: rows }, () => new Float32Array(cols));
  const half = Math.floor(windowSize / 2);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      let score = 0;
      for (let k = -half; k <= half; k += 1) {
        const ai = i + k;
        const bj = j + k;
        if (ai < 0 || ai >= rows || bj < 0 || bj >= cols) continue;
        score += scorePair(seqA[ai], seqB[bj], mode);
      }
      normalized[i][j] = score;
      if (score < min) min = score;
      if (score > max) max = score;
    }
  }

  const range = max - min || 1;
  for (const row of normalized) {
    for (let i = 0; i < row.length; i += 1) {
      row[i] = (row[i] - min) / range;
    }
  }

  return {
    normalized: normalized.map((row) => [...row]),
    min,
    max,
    rows,
    cols,
  };
}

self.addEventListener('message', (event) => {
  try {
    const { seqA, seqB, windowSize, mode } = event.data;
    self.postMessage(computeDotplot(seqA, seqB, windowSize, mode));
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
