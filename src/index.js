import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig, validateEnv } from './config.js';
import { setDryRun, logger } from './utils/logger.js';
import { fetchAllSources } from './fetchers/index.js';
import { discoverGreenhouseSlugs } from './fetchers/greenhouse-discover.js';
import { deduplicateJobs, prefilter } from './pipeline/prefilter.js';
import { scoreJobs } from './pipeline/scorer.js';
import { writeReport } from './pipeline/reporter.js';
import { readResume } from './resume/reader.js';
import { tailorResume } from './resume/tailor.js';
import { writeResume } from './resume/writer.js';

// ─── CLI arg parsing ────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    tailor:    { type: 'boolean', default: false },
    'no-score':{ type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    batch:     { type: 'boolean', default: false },
    top:       { type: 'string'  },
    sources:   { type: 'string'  },
  },
  strict: false,
});

const flags = {
  tailor:   args.tailor,
  noScore:  args['no-score'],
  dryRun:   args['dry-run'],
  useBatch: args.batch,
  topN:     args.top ? parseInt(args.top, 10) : null,
  sources:  args.sources ? args.sources.split(',').map(s => s.trim()) : ['remotive', 'themuse', 'greenhouse'],
};

if (flags.dryRun) {
  flags.noScore = true;
  setDryRun(true);
}

// ─── Startup ────────────────────────────────────────────────────────────────

const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion < 20) {
  console.error('[ERROR] Node.js 20+ is required. Please upgrade.');
  process.exit(1);
}
if (nodeVersion < 22) {
  logger.warn('Node.js 20 detected — permission flags have limited per-domain network control. Upgrade to Node 22+ for full sandboxing.');
}

const config = loadConfig();

// Apply CLI overrides
if (flags.topN && !isNaN(flags.topN)) {
  config.scoring.topN = flags.topN;
}

validateEnv(config, flags);

// Check output dir exists
const outDir = resolve(config.output.directory);
if (!existsSync(outDir)) {
  console.error(`[ERROR] Output directory does not exist: ${outDir}\nCreate it manually with: mkdir output`);
  process.exit(1);
}

// Check resume exists if tailoring
if (flags.tailor && !existsSync(resolve(config.resume.inputPath))) {
  console.error(`[ERROR] Resume not found at: ${config.resume.inputPath}\nAdd your resume.docx to the input/ folder.`);
  process.exit(1);
}

logger.info('─'.repeat(50));
logger.info('Job Search CLI starting up');
logger.info(`Sources: ${flags.sources.join(', ')}`);
logger.info(`Mode: ${flags.dryRun ? 'dry-run' : flags.noScore ? 'fetch+filter only' : flags.useBatch ? 'full (fetch + AI score, Batch API)' : 'full (fetch + AI score)'}`);
logger.info(`Tailoring: ${flags.tailor ? `enabled (top ${config.resume.tailorTopN})` : 'disabled'}`);
logger.info('─'.repeat(50));

// ─── Main pipeline ──────────────────────────────────────────────────────────

async function main() {
  // 0. Discover new Greenhouse companies (skipped in dry-run)
  if (!flags.dryRun && config.sources.greenhouse.enabled && flags.sources.includes('greenhouse')) {
    logger.info('\n[STEP 0] Discovering new Greenhouse companies via The Muse…');
    const newSlugs = await discoverGreenhouseSlugs(config);
    if (newSlugs.length > 0) {
      config.sources.greenhouse.companySlugs = [
        ...new Set([...config.sources.greenhouse.companySlugs, ...newSlugs]),
      ].sort();
    }
  }

  // 1. Fetch
  logger.info('\n[STEP 1] Fetching job listings…');
  const rawJobs = await fetchAllSources(config, flags.sources);

  if (rawJobs.length === 0) {
    logger.error('No jobs fetched from any source. Check your internet connection or source config.');
    process.exit(1);
  }
  logger.info(`Fetched ${rawJobs.length} total raw listings`);

  // 2. Deduplicate
  const unique = deduplicateJobs(rawJobs);
  logger.info(`After deduplication: ${unique.length}`);

  // 3. Pre-filter
  logger.info('\n[STEP 2] Pre-filtering…');
  const filtered = prefilter(unique, config.profile, config.scoring);

  if (filtered.length === 0) {
    logger.warn('No jobs passed the pre-filter. Try loosening your config (skills, locations, targetRoles, maxAgeDays).');
    writeReport([], { totalFetched: rawJobs.length, afterPrefilter: 0 }, config);
    process.exit(0);
  }

  // 4. AI scoring
  let scored = filtered;
  if (!flags.noScore) {
    logger.info('\n[STEP 3] AI scoring with Claude…');
    scored = await scoreJobs(filtered, config, { useBatch: flags.useBatch });
  } else {
    logger.info('\n[STEP 3] Skipping AI scoring (--no-score / --dry-run)');
    scored = filtered.map(j => ({ ...j, score: null, scoreReason: null }));
  }

  // 5. Sort and threshold
  let final = scored;
  if (!flags.noScore) {
    final = scored
      .filter(j => j.score !== null && j.score >= config.scoring.minimumScore)
      .sort((a, b) => b.score - a.score || b.postedAt.localeCompare(a.postedAt));
    logger.info(`After score threshold (≥${config.scoring.minimumScore}): ${final.length} jobs`);
  } else {
    // Sort by date when no scoring
    final = scored.sort((a, b) => {
      if (a.postedAt === 'unknown') return 1;
      if (b.postedAt === 'unknown') return -1;
      return b.postedAt.localeCompare(a.postedAt);
    });
  }

  // 6. Resume tailoring
  if (flags.tailor && final.length > 0) {
    logger.info(`\n[STEP 4] Tailoring resumes for top ${config.resume.tailorTopN} jobs…`);
    let resumeText;
    try {
      resumeText = await readResume(config.resume.inputPath);
    } catch (err) {
      logger.error(`Resume read failed: ${err.message} — skipping tailoring`);
      resumeText = null;
    }

    if (resumeText) {
      const toTailor = final.slice(0, config.resume.tailorTopN);
      for (const job of toTailor) {
        try {
          const tailored = await tailorResume(resumeText, job);
          const path = await writeResume(tailored, job, outDir);
          job.tailoredPath = path;
        } catch (err) {
          logger.warn(`[tailor] Failed for ${job.title} @ ${job.company}: ${err.message}`);
        }
      }
    }
  } else if (flags.tailor) {
    logger.info('\n[STEP 4] No jobs to tailor.');
  }

  // 7. Write report
  logger.info('\n[STEP 5] Writing Markdown report…');
  const reportPath = writeReport(final, { totalFetched: rawJobs.length, afterPrefilter: filtered.length }, config);

  // ─── Summary ────────────────────────────────────────────────────────────
  logger.info('\n' + '─'.repeat(50));
  logger.info('Done!');
  logger.info(`Report: ${reportPath}`);
  logger.info(`Jobs shown: ${final.length}`);
  if (flags.tailor) {
    const tailored = final.filter(j => j.tailoredPath).length;
    logger.info(`Tailored resumes: ${tailored} (in ${outDir}/resumes/)`);
  }
  logger.info('─'.repeat(50));
}

main().catch(err => {
  logger.error('Unexpected error:', err.message);
  process.exit(1);
});
