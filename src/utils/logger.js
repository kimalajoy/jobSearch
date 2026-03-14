const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

let dryRun = false;

export function setDryRun(val) {
  dryRun = val;
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

function prefix(level) {
  const tag = dryRun ? '[DRY RUN] ' : '';
  return `[${timestamp()}] ${tag}[${level.toUpperCase()}]`;
}

export const logger = {
  debug: (...args) => LEVELS.debug >= LOG_LEVEL && console.debug(prefix('debug'), ...args),
  info:  (...args) => LEVELS.info  >= LOG_LEVEL && console.info(prefix('info'), ...args),
  warn:  (...args) => LEVELS.warn  >= LOG_LEVEL && console.warn(prefix('warn'), ...args),
  error: (...args) => LEVELS.error >= LOG_LEVEL && console.error(prefix('error'), ...args),
};
