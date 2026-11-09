/** The serial Mermaid queue: ordering, cancellation and no stale publication. */

import { describe, expect, it } from "vitest";

import { DiagramQueue, DiagramTaskAbortedError, isDiagramAbort } from "@/mermaid/queue";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("DiagramQueue", () => {
  it("runs tasks strictly one at a time", async () => {
    const queue = new DiagramQueue();
    const events: string[] = [];

    const task = (name: string) => async () => {
      events.push(`start:${name}`);
      await delay(5);
      events.push(`end:${name}`);
      return name;
    };

    const results = await Promise.all([
      queue.enqueue(task("a")),
      queue.enqueue(task("b")),
      queue.enqueue(task("c")),
    ]);

    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("refuses a task that was cancelled before it started", async () => {
    const queue = new DiagramQueue();
    const controller = new AbortController();
    controller.abort();
    let ran = false;

    await expect(
      queue.enqueue(async () => {
        ran = true;
        return "never";
      }, controller.signal),
    ).rejects.toBeInstanceOf(DiagramTaskAbortedError);
    expect(ran).toBe(false);
  });

  it("rejects a task cancelled while it was running, keeping the DOM untouched", async () => {
    const queue = new DiagramQueue();
    const controller = new AbortController();
    let ran = false;

    const result = queue.enqueue(async () => {
      ran = true;
      controller.abort();
      return "stale svg";
    }, controller.signal);

    await expect(result).rejects.toBeInstanceOf(DiagramTaskAbortedError);
    expect(ran).toBe(true);
    expect(isDiagramAbort(new DiagramTaskAbortedError())).toBe(true);
    expect(isDiagramAbort(new Error("boom"))).toBe(false);
  });

  it("keeps serving later tasks after a failure", async () => {
    const queue = new DiagramQueue();

    await expect(
      queue.enqueue(async () => {
        throw new Error("broken diagram");
      }),
    ).rejects.toThrow("broken diagram");

    await expect(queue.enqueue(async () => "next")).resolves.toBe("next");
  });

  it("reports queued work and drains it", async () => {
    const queue = new DiagramQueue();
    const first = queue.enqueue(async () => {
      await delay(5);
      return 1;
    });
    const second = queue.enqueue(async () => 2);

    expect(queue.pending).toBe(2);
    await queue.drained();
    expect(queue.pending).toBe(0);
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
  });
});
