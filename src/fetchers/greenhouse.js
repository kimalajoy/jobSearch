import { fetchWithRetry } from '../utils/retry.js';
import { normalizeGreenhouse } from '../pipeline/normalize.js';
import { logger } from '../utils/logger.js';

const BASE = 'https://boards-api.greenhouse.io/v1/boards';
const MAX_SLUGS = 30;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCompanyName(slug) {
  try {
    const res = await fetchWithRetry(`${BASE}/${slug}`);
    if (!res.ok) return slug.charAt(0).toUpperCase() + slug.slice(1);
    const data = await res.json();
    return data.name ?? slug;
  } catch {
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }
}

export async function fetchGreenhouse(config) {
  let { companySlugs } = config.sources.greenhouse;

  if (companySlugs.length > MAX_SLUGS) {
    logger.warn(`[greenhouse] companySlugs capped at ${MAX_SLUGS}. Ignoring extra slugs.`);
    companySlugs = companySlugs.slice(0, MAX_SLUGS);
  }

  const allJobs = [];

  for (const slug of companySlugs) {
    try {
      const companyName = await fetchCompanyName(slug);
      await sleep(200);

      const url = `${BASE}/${slug}/jobs?content=true`;
      logger.info(`[greenhouse] Fetching ${companyName} (${slug})`);

      const res = await fetchWithRetry(url);

      if (res.status === 404) {
        logger.warn(`[greenhouse] Slug "${slug}" not found (404) — skipping`);
        await sleep(400);
        continue;
      }

      if (!res.ok) {
        logger.warn(`[greenhouse] HTTP ${res.status} for slug "${slug}" — skipping`);
        await sleep(400);
        continue;
      }

      const data = await res.json();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      logger.info(`[greenhouse] ${companyName}: ${jobs.length} listings`);
      allJobs.push(...jobs.map(j => normalizeGreenhouse(j, companyName)));
    } catch (err) {
      logger.warn(`[greenhouse] Error fetching slug "${slug}": ${err.message} — skipping`);
    }

    await sleep(400);
  }

  logger.info(`[greenhouse] Total fetched: ${allJobs.length}`);
  return allJobs;
}
