// @vitest-environment jsdom

/**
 * Menu behaviour.
 *
 * Regression guard for a reported bug: hovering a row *inside* an open submenu
 * cleared the parent's selection, which unmounted the list the pointer was
 * moving into — making Insert → Diagram impossible to use with a mouse.
 *
 * Labels are asserted in English: the interface language follows the system
 * locale, and the test environment reports none.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MenuBar } from "@/app/MenuBar";
import { useDocumentsStore } from "@/tabs/documentsStore";

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  // jsdom lacks the observers that CodeMirror's measurement code touches while
  // the editor modules are being imported.
  const noop = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as Record<string, unknown>).ResizeObserver ??= noop;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= noop;
  (globalThis as Record<string, unknown>).matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  // Insert is disabled without an open document.
  useDocumentsStore.setState({
    documents: [
      {
        id: "doc-1",
        path: null,
        title: "Untitled",
        content: "# hi",
        savedContent: "",
        encoding: "UTF-8",
        eol: "lf",
        bom: false,
        readOnly: false,
        dirty: true,
        baseHash: null,
        external: "none",
        cursorLine: 1,
        cursorCol: 1,
        scrollTop: 0,
        contentEpoch: 0,
      },
    ],
    activeId: "doc-1",
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Fire the event React uses to synthesise `onPointerEnter`. */
function hover(element: Element, from?: Element | null): void {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true, cancelable: true, relatedTarget: from ?? null }),
    );
  });
}

function press(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
}

/** A menu row carries an arrow glyph, so match on its label child instead. */
function labelNode(text: string): HTMLElement | null {
  const found = [...container.querySelectorAll<HTMLElement>(".menu-label")].find(
    (node) => node.textContent?.trim() === text,
  );
  return found ?? null;
}

function row(text: string): HTMLElement {
  const element = labelNode(text)?.closest<HTMLElement>(".menu-row");
  if (!element) throw new Error(`no menu row labelled "${text}"`);
  return element;
}

function menubarButton(title: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>(".menubar-button")].find(
    (node) => node.textContent?.trim() === title,
  );
  if (!found) throw new Error(`no menu titled "${title}"`);
  return found;
}

const submenu = () => container.querySelector<HTMLElement>(".menu-submenu");

/**
 * Wait past the submenu close delay.
 *
 * Asserting immediately after a hover would pass even with the bug present,
 * because the pending close has not fired yet. Waiting makes the check real.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

describe("menu submenus", () => {
  it("opens a submenu when its parent row is hovered", () => {
    act(() => root.render(<MenuBar />));
    press(menubarButton("Insert"));

    expect(labelNode("Diagram")).not.toBeNull();

    hover(row("Diagram"));

    expect(submenu()).not.toBeNull();
    expect(submenu()?.textContent).toContain("Flowchart");
  });

  it("keeps the submenu open while the pointer moves into it", async () => {
    act(() => root.render(<MenuBar />));
    press(menubarButton("Insert"));

    const diagram = row("Diagram");
    hover(diagram);
    expect(submenu()).not.toBeNull();

    // This is the step that used to unmount the submenu.
    const list = submenu();
    const flowchart = row("Flowchart");
    hover(flowchart, diagram);
    await settle();

    expect(submenu()).not.toBeNull();
    expect(list?.isConnected).toBe(true);
    expect(flowchart.isConnected).toBe(true);
  });

  it("stays open when the pointer crosses from one submenu row to the next", async () => {
    act(() => root.render(<MenuBar />));
    press(menubarButton("Insert"));
    hover(row("Diagram"));

    const first = row("Flowchart");
    hover(first);
    await settle();

    const second = row("Sequence Diagram");
    hover(second, first);
    await settle();

    expect(submenu()).not.toBeNull();
    expect(second.isConnected).toBe(true);
  });

  it("closes the submenu when a different top-level row is hovered", async () => {
    act(() => root.render(<MenuBar />));
    press(menubarButton("Insert"));
    hover(row("Diagram"));
    expect(submenu()).not.toBeNull();

    hover(row("Link"));

    // The close is deliberately delayed so the pointer can still reach the
    // submenu; wait past that window.
    await settle();

    expect(submenu()).toBeNull();
  });

  it("closes everything when the menu button is pressed again", () => {
    act(() => root.render(<MenuBar />));

    const insert = menubarButton("Insert");
    press(insert);
    expect(container.querySelector(".menu-dropdown")).not.toBeNull();

    press(insert);
    expect(container.querySelector(".menu-dropdown")).toBeNull();
  });
});
