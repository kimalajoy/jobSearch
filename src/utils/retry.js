import { logger } from './logger.js';

// Internal domain allowlist — enforced in code even if --allow-net is all-or-nothing on Node 20
const ALLOWED_HOSTS = new Set([
  'remotive.com',
  'www.themuse.com',
  'boards-api.greenhouse.io',
  'api.anthropic.com',
]);

export function assertAllowedHost(url) {
  const { hostname } = new URL(url);
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new Error(`Blocked request to disallowed host: ${hostname}`);
  }
}

export async function fetchWithRetry(url, options = {}, maxAttempts = 3) {
  assertAllowedHost(url);

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);

      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '0', 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1);
        logger.warn(`HTTP ${res.status} from ${url} — retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
        await sleep(delay);
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = 1000 * 2 ** (attempt - 1);
        logger.warn(`Network error fetching ${url} — retrying in ${delay}ms (attempt ${attempt}/${maxAttempts}): ${err.message}`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
