/**
 * One global queue in front of Mermaid.
 *
 * `mermaid.initialize()` and `mermaid.render()` both mutate module-level state:
 * a second render started while the first is still running would be measured
 * with the wrong configuration and would interleave the temporary DOM the
 * renderer creates. A single serial queue is the smallest thing that removes
 * the class of bug entirely.
 *
 * Cancellation is cooperative: a task that was cancelled before it started never
 * runs, and a task that finishes after cancellation is reported as an
 * `AbortError` so the caller cannot publish a stale SVG.
 */

export class DiagramTaskAbortedError extends Error {
  readonly aborted = true;

  constructor() {
    super("The diagram render was cancelled.");
    this.name = "DiagramTaskAbortedError";
  }
}

export function isDiagramAbort(error: unknown): boolean {
  return error instanceof DiagramTaskAbortedError;
}

export type DiagramTask<T> = (signal: AbortSignal | undefined) => Promise<T>;

export class DiagramQueue {
  private tail: Promise<void> = Promise.resolve();

  /** Number of tasks that were accepted but have not settled yet. */
  private waiting = 0;

  /** Run `task` after every previously queued task has settled. */
  enqueue<T>(task: DiagramTask<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DiagramTaskAbortedError());

    this.waiting += 1;

    const run = async (): Promise<T> => {
      if (signal?.aborted) throw new DiagramTaskAbortedError();

      const result = await task(signal);

      // The task may have been cancelled while Mermaid was working. The result
      // still belongs to nobody: the caller must not publish it.
      if (signal?.aborted) throw new DiagramTaskAbortedError();

      return result;
    };

    const result = this.tail.then(run, run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tail.finally(() => {
      this.waiting -= 1;
    });

    return result;
  }

  get pending(): number {
    return this.waiting;
  }

  /** Resolves once every task queued so far has settled. */
  async drained(): Promise<void> {
    await this.tail;
  }
}

/** Shared by the preview renderer and the render lab. */
export const diagramQueue = new DiagramQueue();
