import { fetchRemotive } from './remotive.js';
import { fetchTheMuse } from './themuse.js';
import { fetchGreenhouse } from './greenhouse.js';
import { logger } from '../utils/logger.js';

export async function fetchAllSources(config, enabledSources) {
  const tasks = [];

  if (config.sources.remotive.enabled && enabledSources.includes('remotive')) {
    tasks.push({ name: 'remotive', fn: () => fetchRemotive(config) });
  }
  if (config.sources.themuse.enabled && enabledSources.includes('themuse')) {
    tasks.push({ name: 'themuse', fn: () => fetchTheMuse(config) });
  }
  if (config.sources.greenhouse.enabled && enabledSources.includes('greenhouse')) {
    tasks.push({ name: 'greenhouse', fn: () => fetchGreenhouse(config) });
  }

  if (tasks.length === 0) {
    logger.warn('No sources enabled. Check your config.json sources settings.');
    return [];
  }

  const results = await Promise.allSettled(tasks.map(t => t.fn()));
  const allJobs = [];

  results.forEach((result, i) => {
    const { name } = tasks[i];
    if (result.status === 'fulfilled') {
      allJobs.push(...result.value);
    } else {
      logger.warn(`[${name}] Fetch failed: ${result.reason?.message ?? result.reason}`);
    }
  });

  return allJobs;
}
