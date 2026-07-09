const DEFAULT_FALLBACK_URL = 'http://172.30.1.29:5000';

export function nasUrlCandidates(env = process.env) {
  const primary = env.NAS_URL;
  const fallback = env.NAS_FALLBACK_URL || DEFAULT_FALLBACK_URL;
  return [primary, fallback]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx);
}
