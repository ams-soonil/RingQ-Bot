export interface JobQueue {
  enqueue(runId: string): void;
  size(): number;
  onIdle(): Promise<void>;
}

export function createQueue(handler: (runId: string) => Promise<void>): JobQueue {
  const jobs: string[] = [];
  let running = false;
  const idleWaiters: Array<() => void> = [];

  function resolveIdle() {
    while (idleWaiters.length) idleWaiters.shift()!();
  }

  async function drain() {
    if (running) return;
    running = true;
    while (jobs.length) {
      const runId = jobs.shift()!;
      try {
        await handler(runId);
      } catch (err) {
        // handler가 실패를 store/이벤트로 기록한다. 큐는 멈추지 않는다.
        console.error(`[queue] job ${runId} failed:`, err);
      }
    }
    running = false;
    resolveIdle();
  }

  return {
    enqueue(runId) {
      jobs.push(runId);
      void drain();
    },
    size() {
      return jobs.length;
    },
    onIdle() {
      if (!running && jobs.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
