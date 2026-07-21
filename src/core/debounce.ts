/**
 * Coalesce a burst of triggers into a single asynchronous run.
 *
 * File watchers fire storms of events — atomic saves arrive as delete+create,
 * a git checkout touches thousands of paths. This collapses everything within
 * `waitMs` into one run, and never overlaps runs: a trigger that lands while a
 * run is in flight schedules exactly one follow-up after it completes.
 */
export function createDebouncer(
  fn: () => Promise<void> | void,
  waitMs: number
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;

  const run = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await fn();
    } catch {
      // A rejecting fn must not wedge the debouncer or escalate to an
      // unhandled rejection (which terminates the process under Node's default).
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void run();
      }
    }
  };

  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, waitMs);
  };
}
