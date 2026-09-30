/**
 * Access to the live preview DOM.
 *
 * Exporting uses the rendered DOM rather than re-rendering from source, so the
 * exported file contains the same highlighted code and the same Mermaid SVGs the
 * user is looking at.
 */

let container: HTMLElement | null = null;

export function setPreviewContainer(element: HTMLElement | null): void {
  container = element;
}

export function previewContainer(): HTMLElement | null {
  return container;
}
