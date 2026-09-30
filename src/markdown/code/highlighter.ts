/**
 * Shiki highlighter, created once and shared by every render.
 *
 * Two deliberate choices:
 *
 * 1. The JavaScript regular expression engine is used instead of the WASM
 *    Oniguruma engine. It keeps the Content Security Policy free of
 *    `wasm-unsafe-eval`, and the accuracy difference only shows up in exotic
 *    grammars, where a failed tokenisation falls back to plain text anyway.
 * 2. Only a small set of languages is loaded eagerly; the rest are loaded on
 *    first use and cached, so opening a README does not pay for the 600+
 *    grammars Shiki ships.
 */

import { createBundledHighlighter } from "shiki/core";
import { bundledLanguages } from "shiki/langs";
import { bundledThemes } from "shiki/themes";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { HighlighterGeneric } from "shiki/core";
import type { BundledLanguage, BundledTheme } from "shiki";

const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine({ target: "ES2024" }),
});

export const CODE_THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const;

export type CodeThemeName = (typeof CODE_THEMES)[keyof typeof CODE_THEMES];

/** Languages loaded before the first render, covering the common README case. */
const EAGER_LANGUAGES = [
  "markdown",
  "json",
  "jsonc",
  "yaml",
  "toml",
  "ini",
  "bash",
  "shell",
  "diff",
  "javascript",
  "typescript",
  "html",
  "css",
];

/** Fence info strings that should be treated as another language. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shell",
  console: "shell",
  zsh: "shell",
  ps: "powershell",
  ps1: "powershell",
  yml: "yaml",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  kt: "kotlin",
  htm: "html",
  xhtml: "html",
  svg: "xml",
  md: "markdown",
  docker: "dockerfile",
  make: "makefile",
  text: "plaintext",
  txt: "plaintext",
};

export type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

let highlighterPromise: Promise<Highlighter | null> | null = null;
const loadedLanguages = new Set<string>(EAGER_LANGUAGES);
/** Languages Shiki does not know about; remembered so we stop retrying. */
const unknownLanguages = new Set<string>();

/** Fences that are handled by a dedicated renderer rather than Shiki. */
const NON_CODE_LANGUAGES = new Set(["mermaid", "", "plaintext", "text"]);

function normaliseLanguage(raw: string | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "plaintext";
  return LANGUAGE_ALIASES[value] ?? value;
}

export function isHighlightable(language: string): boolean {
  return !NON_CODE_LANGUAGES.has(language);
}

export function normaliseFenceLanguage(raw: string | undefined): string {
  return normaliseLanguage(raw);
}

async function create(): Promise<Highlighter | null> {
  try {
    return await createHighlighter({
      themes: [CODE_THEMES.light, CODE_THEMES.dark],
      langs: EAGER_LANGUAGES,
    });
  } catch (error) {
    // Highlighting is a progressive enhancement; the preview still renders.
    console.error("Shiki failed to initialise, code blocks will render unstyled", error);
    return null;
  }
}

/** The shared highlighter, created on first call. Resolves to `null` on failure. */
export function getHighlighter(): Promise<Highlighter | null> {
  highlighterPromise ??= create();
  return highlighterPromise;
}

/** Start loading Shiki in the background so the first preview is already fast. */
export function primeHighlighter(): void {
  void getHighlighter();
}

/**
 * Make sure `language` can be highlighted, loading its grammar if needed.
 * Returns `false` when the language is unknown to Shiki.
 */
export async function ensureLanguage(language: string): Promise<boolean> {
  if (unknownLanguages.has(language)) return false;

  const highlighter = await getHighlighter();
  if (!highlighter) return false;

  if (loadedLanguages.has(language)) {
    return highlighter.getLoadedLanguages().includes(language);
  }

  if (!Object.prototype.hasOwnProperty.call(bundledLanguages, language)) {
    unknownLanguages.add(language);
    return false;
  }

  try {
    await highlighter.loadLanguage(language as keyof typeof bundledLanguages);
    loadedLanguages.add(language);
    return true;
  } catch (error) {
    console.warn(`Shiki could not load the "${language}" grammar`, error);
    unknownLanguages.add(language);
    return false;
  }
}

export function themeForAppearance(appearance: "light" | "dark" | "auto", override: string): string {
  if (override && override !== "auto") return override;
  return appearance === "dark" ? CODE_THEMES.dark : CODE_THEMES.light;
}

/** Languages offered in the Insert → Code Block picker. */
export const CODE_LANGUAGE_CHOICES = [
  "text",
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "makefile",
  "markdown",
  "php",
  "powershell",
  "python",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "toml",
  "typescript",
  "xml",
  "yaml",
];
