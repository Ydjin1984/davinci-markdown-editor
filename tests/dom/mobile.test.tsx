// @vitest-environment jsdom

/**
 * The Android shell.
 *
 * The phone build exists to be read from: a document opens rendered, and the
 * source text is a writing tool that lives one level down in the menu rather
 * than a switch on the screen. These tests pin that arrangement — the exports
 * that survive on a phone are reachable in one tap, everything else is not on
 * the first level — because it is the whole difference between the two shells.
 *
 * Labels are asserted in English: the interface language follows the system
 * locale, and the test environment reports none.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/ipc", () => ({
  pickOpenFiles: vi.fn(async () => []),
  printDocument: vi.fn(async () => undefined),
  pickSavePath: vi.fn(async () => null),
  writeExportFile: vi.fn(async () => undefined),
  confirmDialog: vi.fn(async () => undefined),
  onOpenUri: vi.fn(async () => () => undefined),
}));

const { MobileMenu } = await import("@/app/MobileMenu");
const { useDocumentsStore } = await import("@/tabs/documentsStore");
const { useUiStore } = await import("@/app/uiStore");
// The raw text is the same stylesheet the printed page and the HTML export
// receive, so the rules in it are worth asserting on directly.
const { default: printCss } = await import("@/styles/print.css?raw");

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  // jsdom lacks the observers CodeMirror's measurement code touches while the
  // editor modules are being imported.
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

  useDocumentsStore.setState({
    documents: [
      {
        id: "doc-1",
        path: "content://com.android.providers.downloads/document/42",
        title: "notes.md",
        content: "# hi",
        savedContent: "# hi",
        encoding: "UTF-8",
        eol: "lf",
        bom: false,
        readOnly: false,
        dirty: false,
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

/** Every label currently on screen, in menu order. */
function rows(): string[] {
  return [...container.querySelectorAll(".mobile-row__label")].map((node) => node.textContent ?? "");
}

/** Press the toolbar button carrying the given accessible name. */
function press(label: string, index = 0): void {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => {
    const named = button.getAttribute("aria-label") === label;
    const labelled = button.querySelector(".mobile-row__label")?.textContent === label;
    return named || labelled;
  });
  const button = buttons[index];
  if (!button) throw new Error(`No button named ${label}`);
  act(() => button.click());
}

function openMenu(): void {
  press("Menu");
}

describe("the phone menu", () => {
  it("opens with nothing but the document's name and the menu button", () => {
    act(() => root.render(<MobileMenu sourceVisible={false} onToggleSource={() => {}} />));

    expect(rows()).toEqual([]);
    expect(container.querySelector(".mobile-bar__title")?.textContent).toBe("notes.md");
  });

  it("keeps the exports on the first level", () => {
    act(() => root.render(<MobileMenu sourceVisible={false} onToggleSource={() => {}} />));
    openMenu();

    // The export group is one tap away; its entries are one more.
    expect(rows()).toContain("Export");
    press("Export");
    expect(rows()).toContain("Export as PDF…");
    expect(rows()).toContain("Export as HTML…");
  });

  it("hides the source text behind More", () => {
    act(() => root.render(<MobileMenu sourceVisible={false} onToggleSource={() => {}} />));
    openMenu();

    // Reading is what the phone build is for: the source view must not be
    // sitting on the first level where it could be tapped by accident.
    expect(rows()).not.toContain("Source Text");

    press("More");
    expect(rows()).toContain("Source Text");
    expect(rows()).toContain("About");
  });

  it("reports the source view as checked and toggles it", () => {
    const onToggleSource = vi.fn();
    act(() => root.render(<MobileMenu sourceVisible onToggleSource={onToggleSource} />));
    openMenu();
    press("More");

    const row = [...container.querySelectorAll<HTMLButtonElement>(".mobile-row")].find((button) =>
      button.textContent?.includes("Source Text"),
    );
    expect(row?.querySelector(".mobile-row__check")?.textContent).toBe("✓");

    act(() => row?.click());
    expect(onToggleSource).toHaveBeenCalledTimes(1);
    // The sheet closes with the choice it carried out.
    expect(rows()).toEqual([]);
  });

  it("shows About without leaving the shell", () => {
    act(() => root.render(<MobileMenu sourceVisible={false} onToggleSource={() => {}} />));
    openMenu();
    press("More");

    const row = [...container.querySelectorAll<HTMLButtonElement>(".mobile-row")].find((button) =>
      button.textContent?.includes("About"),
    );
    act(() => row?.click());

    expect(useUiStore.getState().dialog).toBe("about");
  });
});

describe("platform detection", () => {
  it("recognises a document handed over by the Android picker", async () => {
    const { isContentUri } = await import("@/shared/platform");

    expect(isContentUri("content://com.android.providers.downloads/document/42")).toBe(true);
    expect(isContentUri("E:\\notes.md")).toBe(false);
    expect(isContentUri(null)).toBe(false);
  });

  it("reports the phone shell for an Android user agent", async () => {
    vi.resetModules();
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15; sdk_gphone64_x86_64) AppleWebKit/537.36",
    });

    const { isMobile } = await import("@/shared/platform");
    expect(isMobile).toBe(true);

    vi.unstubAllGlobals();
    vi.resetModules();
  });
});

describe("printing", () => {
  it("leaves the phone shell out of the printed page", () => {
    // Found on an emulator: the bar and the menu went into the PDF because
    // only the desktop chrome was hidden.
    const chrome = printCss.slice(printCss.indexOf("--- chrome"), printCss.indexOf("--- layout"));

    expect(chrome).toContain(".mobile-bar");
    expect(chrome).toContain(".mobile-sheet");
    expect(chrome).toContain(".mobile-empty");
  });
});
