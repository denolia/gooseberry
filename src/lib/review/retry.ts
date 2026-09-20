const RETRY_DELAYS_MS = [300, 900, 1_800] as const;

type Wait = (delayMs: number) => Promise<void>;

const wait: Wait = (delayMs) =>
  new Promise((resolve) => window.setTimeout(resolve, delayMs));

export async function withAutomaticRetries<T>(
  operation: () => Promise<T>,
  retries = RETRY_DELAYS_MS.length,
  waitForRetry: Wait = wait,
): Promise<T> {
  let failures = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (failures >= retries) throw error;
      const delay =
        RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
      failures += 1;
      await waitForRetry(delay);
    }
  }
}
