/**
 * Transparent, local translation-quality estimates for classroom demos.
 * BLEU: sentence-level, up to four word n-grams, add-one smoothing,
 * with a brevity penalty. The Unicode-aware tokenizer is intentionally
 * lightweight, so results are not directly comparable with sacreBLEU.
 * chrF2: character n-gram F-score, n=1..6, beta=2, excluding whitespace.
 * Scores are similarity to a supplied reference, not percent correctness.
 */

function countNgrams(items, n) {
  const counts = new Map();
  for (let i = 0; i <= items.length - n; i += 1) {
    const key = JSON.stringify(items.slice(i, i + n));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function countMatches(candidateCounts, referenceCounts) {
  let matches = 0;
  let candidateTotal = 0;
  let referenceTotal = 0;
  for (const count of candidateCounts.values()) candidateTotal += count;
  for (const count of referenceCounts.values()) referenceTotal += count;
  for (const [ngram, count] of candidateCounts) {
    matches += Math.min(count, referenceCounts.get(ngram) || 0);
  }
  return { matches, candidateTotal, referenceTotal };
}

function tokenizeWords(text) {
  const normalized = text.normalize('NFC').toLocaleLowerCase();
  // Intl.Segmenter handles word boundaries in Japanese and Indic languages
  // much better than splitting text on spaces alone.
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return Array.from(segmenter.segment(normalized))
      .map(({ segment }) => segment.trim())
      .filter((segment) => segment && !/^\s+$/u.test(segment));
  }
  return normalized.match(/[\p{L}\p{M}\p{N}]+|[^\s]/gu) || [];
}

export function calculateBleu(candidate, reference) {
  const hypothesisWords = tokenizeWords(candidate);
  const referenceWords = tokenizeWords(reference);
  const length = hypothesisWords.length;
  const refLength = referenceWords.length;
  if (!length || !refLength) return 0;

  const order = Math.min(4, length);
  let logPrecisionSum = 0;
  for (let n = 1; n <= order; n += 1) {
    const counts = countMatches(
      countNgrams(hypothesisWords, n),
      countNgrams(referenceWords, n),
    );
    // Add-one smoothing avoids a hard zero from a single unmatched n-gram.
    const precision = (counts.matches + 1) / (counts.candidateTotal + 1);
    logPrecisionSum += Math.log(precision);
  }
  const brevityPenalty = Math.exp(Math.min(0, 1 - refLength / length));
  return 100 * brevityPenalty * Math.exp(logPrecisionSum / order);
}

export function calculateChrF(candidate, reference) {
  const candidateChars = Array.from(candidate.normalize('NFC').replace(/\s/gu, ''));
  const referenceChars = Array.from(reference.normalize('NFC').replace(/\s/gu, ''));
  if (!candidateChars.length || !referenceChars.length) return 0;
  const maxOrder = Math.min(6, candidateChars.length, referenceChars.length);
  let totalPrecision = 0;
  let totalRecall = 0;

  for (let n = 1; n <= maxOrder; n += 1) {
    const { matches, candidateTotal, referenceTotal } = countMatches(
      countNgrams(candidateChars, n),
      countNgrams(referenceChars, n),
    );
    totalPrecision += matches / candidateTotal;
    totalRecall += matches / referenceTotal;
  }
  const precision = totalPrecision / maxOrder;
  const recall = totalRecall / maxOrder;
  const betaSquared = 4;
  const denominator = betaSquared * precision + recall;
  return denominator
    ? (100 * (1 + betaSquared) * precision * recall) / denominator
    : 0;
}

export function evaluateTranslation(candidate, reference) {
  if (!candidate.trim() || !reference.trim()) return null;
  return {
    bleu: Number(calculateBleu(candidate.trim(), reference.trim()).toFixed(1)),
    chrf: Number(calculateChrF(candidate.trim(), reference.trim()).toFixed(1)),
  };
}
