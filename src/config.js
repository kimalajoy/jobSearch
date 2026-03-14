import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadConfig() {
  const configPath = resolve('./config.json');
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`[ERROR] Could not read config.json: ${err.message}`);
    process.exit(1);
  }

  // Merge with defaults
  const cfg = {
    profile: {
      targetRoles: ['Frontend Developer', 'React Developer'],
      seniorityLevel: 'mid',
      skills: ['React', 'JavaScript', 'CSS'],
      preferredLocations: ['remote'],
      excludeCompanies: [],
      ...raw.profile,
    },
    sources: {
      remotive: { enabled: true, searchQuery: 'frontend developer', ...raw.sources?.remotive },
      themuse: { enabled: true, searchQuery: 'frontend', level: ['Mid Level'], ...raw.sources?.themuse },
      greenhouse: { enabled: true, companySlugs: [], ...raw.sources?.greenhouse },
    },
    scoring: {
      minimumScore: 6,
      topN: 20,
      maxAgeDays: 14,
      ...raw.scoring,
    },
    resume: {
      inputPath: './input/resume.docx',
      tailoringEnabled: false,
      tailorTopN: 5,
      ...raw.resume,
    },
    output: {
      directory: './output',
      ...raw.output,
    },
  };

  // Enforce greenhouse slug cap
  if (cfg.sources.greenhouse.companySlugs.length > 30) {
    console.warn('[WARN] greenhouse.companySlugs capped at 30 to limit API calls. Extra slugs ignored.');
    cfg.sources.greenhouse.companySlugs = cfg.sources.greenhouse.companySlugs.slice(0, 30);
  }

  return cfg;
}

function validateEnv(cfg, flags) {
  const errors = [];

  if (!flags.dryRun && !flags.noScore) {
    if (!process.env.ANTHROPIC_API_KEY) {
      errors.push('ANTHROPIC_API_KEY is required for AI scoring. Add it to your .env file or set --no-score / --dry-run to skip.');
    }
  }

  if (cfg.sources.themuse.enabled && !process.env.THEMUSE_API_KEY) {
    console.warn('[WARN] THEMUSE_API_KEY not set — The Muse results will be limited to 500 req/hr (unauthenticated). Register free at https://www.themuse.com/developers/api/v2');
  }

  if (errors.length) {
    errors.forEach(e => console.error(`[ERROR] ${e}`));
    process.exit(1);
  }
}

export { loadConfig, validateEnv };
