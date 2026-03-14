import { fetchWithRetry } from '../utils/retry.js';
import { normalizeRemotive } from '../pipeline/normalize.js';
import { logger } from '../utils/logger.js';

const BASE = 'https://remotive.com/api/remote-jobs';

export async function fetchRemotive(config) {
  const { searchQuery } = config.sources.remotive;
  const url = `${BASE}?search=${encodeURIComponent(searchQuery)}&limit=50`;

  logger.info(`[remotive] Fetching: ${url}`);
  const res = await fetchWithRetry(url);

  if (!res.ok) {
    throw new Error(`Remotive API returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  logger.info(`[remotive] Fetched ${jobs.length} raw listings`);

  return jobs.map(normalizeRemotive);
}
