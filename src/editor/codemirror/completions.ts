/**
 * Autocomplete sources for Markdown.
 *
 * Kept as data so more sources can be added without touching the editor setup.
 */

import type { CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

const FENCE_LANGUAGES = [
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
  "mermaid",
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

/** Suggest a language right after a fence opening. */
const fenceLanguageSource: CompletionSource = (context: CompletionContext): CompletionResult | null => {
  const before = context.matchBefore(/^[ \t]*(?:`{3,}|~{3,})[a-zA-Z0-9+#-]*/);
  if (!before) return null;

  const start = before.from + before.text.indexOf("`".repeat(3)) + 3;
  const typed = before.text.slice(start - before.from);
  if (!context.explicit && typed.length === 0 && !/^\s*`{3,}$/.test(before.text)) return null;
  if (before.text.includes(" ") && !context.explicit) return null;

  return {
    from: start,
    options: FENCE_LANGUAGES.map((language) => ({ label: language, type: "keyword" })),
    validFor: /^[a-zA-Z0-9+#-]*$/,
  };
};

const REFERENCE_SNIPPETS = [
  { label: "```mermaid", detail: "Mermaid diagram", apply: "```mermaid\n\n```" },
  { label: "table", detail: "3-column table", apply: "| a | b | c |\n| --- | --- | --- |\n|  |  |  |" },
  {
    label: "details",
    detail: "Collapsible section",
    apply: "<details>\n<summary>Title</summary>\n\n\n\n</details>",
  },
  { label: "- [ ]", detail: "Task list item", apply: "- [ ] " },
];

/** Snippet completions available on demand with Ctrl+Space. */
const snippetSource: CompletionSource = (context: CompletionContext): CompletionResult | null => {
  const word = context.matchBefore(/[\w`[\].-]{2,}/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: REFERENCE_SNIPPETS.map((snippet) => ({
      label: snippet.label,
      detail: snippet.detail,
      type: "text",
      apply: snippet.apply,
    })),
    validFor: /^[\w`[\].-]*$/,
  };
};

export const markdownCompletionSources: CompletionSource[] = [fenceLanguageSource, snippetSource];

export { FENCE_LANGUAGES };
