import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchWithRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

const MUSE_BASE = 'https://www.themuse.com/api/public/jobs';
const GH_BASE = 'https://boards-api.greenhouse.io/v1/boards';
const MUSE_PAGES = 5;
const LEGAL_SUFFIXES = /\s*(,\s*)?(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|limited|incorporated|group|holdings|technologies|technology|solutions|labs|studio|studios)\s*$/i;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function fetchMuseCompanyNames(apiKey) {
  const companyNames = new Set();
  const params = new URLSearchParams({ category: 'Software Engineer', page: '0' });
  if (apiKey) params.set('api_key', apiKey);

  for (let page = 0; page < MUSE_PAGES; page++) {
    params.set('page', String(page));
    try {
      const res = await fetchWithRetry(`${MUSE_BASE}?${params}`);
      if (!res.ok) break;
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      for (const job of results) {
        const name = job.company?.name;
        if (name) companyNames.add(name);
      }
      if (page + 1 >= (data.page_count ?? 1)) break;
      await sleep(300);
    } catch {
      break;
    }
  }

  return [...companyNames];
}

async function probeGreenhouseSlug(slug) {
  try {
    const res = await fetchWithRetry(`${GH_BASE}/${slug}`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function discoverGreenhouseSlugs(config) {
  const existing = new Set(config.sources.greenhouse.companySlugs);
  const apiKey = process.env.THEMUSE_API_KEY ?? '';

  logger.info('[discover] Fetching company names from The Muse…');
  const companyNames = await fetchMuseCompanyNames(apiKey);
  logger.info(`[discover] ${companyNames.length} unique companies found in Muse results`);

  const candidates = [...new Set(companyNames.map(toSlug))].filter(s => s.length > 1 && !existing.has(s));
  logger.info(`[discover] ${candidates.length} new slug candidates to probe`);

  const newSlugs = [];
  for (const slug of candidates) {
    const valid = await probeGreenhouseSlug(slug);
    if (valid) {
      logger.info(`[discover] ✓ ${slug} — has Greenhouse board`);
      newSlugs.push(slug);
    }
    await sleep(200);
  }

  if (newSlugs.length === 0) {
    logger.info('[discover] No new Greenhouse companies found');
    return [];
  }

  logger.info(`[discover] Found ${newSlugs.length} new Greenhouse companies — saving to config.json`);

  // Merge into config.json
  const configPath = resolve('./config.json');
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  const merged = [...new Set([...existing, ...newSlugs])].sort();
  raw.sources.greenhouse.companySlugs = merged;
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');

  for (const slug of newSlugs) {
    logger.info(`[discover] Added "${slug}" to config.json`);
  }

  return newSlugs;
}
