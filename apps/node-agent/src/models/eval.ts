/** Standard eval metrics: text normalization + word error rate (WER). */

/** Lowercase, strip punctuation, collapse whitespace — standard WER prep. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Word Error Rate = (substitutions + deletions + insertions) / reference words,
 * via word-level Levenshtein. The standard ASR accuracy metric (LibriSpeech etc).
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeText(reference).split(' ').filter(Boolean);
  const hyp = normalizeText(hypothesis).split(' ').filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;

  const dp: number[][] = Array.from({ length: ref.length + 1 }, () =>
    new Array<number>(hyp.length + 1).fill(0),
  );
  for (let i = 0; i <= ref.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= hyp.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return Math.round((dp[ref.length]![hyp.length]! / ref.length) * 1000) / 1000;
}
