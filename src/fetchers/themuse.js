import { fetchWithRetry } from '../utils/retry.js';
import { normalizeMuse } from '../pipeline/normalize.js';
import { logger } from '../utils/logger.js';

const BASE = 'https://www.themuse.com/api/public/jobs';
const MAX_PAGES = 5; // pages 0–4 = up to 100 results

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchTheMuse(config) {
  const { searchQuery, level } = config.sources.themuse;
  const apiKey = process.env.THEMUSE_API_KEY;

  const allJobs = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ page: String(page) });
    if (searchQuery) params.set('category', searchQuery);
    if (apiKey) params.set('api_key', apiKey);
    if (Array.isArray(level) && level.length) {
      level.forEach(l => params.append('level', l));
    }

    const url = `${BASE}?${params}`;
    logger.info(`[themuse] Fetching page ${page}: ${url}`);

    const res = await fetchWithRetry(url);
    if (!res.ok) {
      logger.warn(`[themuse] HTTP ${res.status} on page ${page} — stopping pagination`);
      break;
    }

    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    logger.info(`[themuse] Page ${page}: ${results.length} listings`);
    allJobs.push(...results);

    // Stop early if we've reached the last page
    if (page + 1 >= (data.page_count ?? 1)) break;

    await sleep(300);
  }

  logger.info(`[themuse] Total fetched: ${allJobs.length}`);
  return allJobs.map(normalizeMuse);
}
