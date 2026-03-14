export function createRateLimiter(minIntervalMs = 1000) {
  let lastCallTime = 0;

  return async function throttle() {
    const elapsed = Date.now() - lastCallTime;
    if (elapsed < minIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, minIntervalMs - elapsed));
    }
    lastCallTime = Date.now();
  };
}
