/** Status bar: caret position, encoding, line endings, language and save state. */

import { useMemo } from "react";
import { useDocumentsStore } from "@/tabs/documentsStore";
import { useCursorStore } from "@/editor/cursorStore";
import { usePreviewStore } from "@/preview/previewStore";
import { countWords, cx, formatBytes } from "@/shared/util";
import { t } from "@/shared/i18n";

export function StatusBar() {
  const document = useDocumentsStore(
    (state) => state.documents.find((item) => item.id === state.activeId) ?? null,
  );
  const activeId = document?.id ?? null;
  const cursor = useCursorStore((state) => (activeId ? (state.positions[activeId] ?? null) : null));
  const pending = usePreviewStore((state) => state.pending);

  const stats = useMemo(() => {
    if (!document) return null;
    return {
      words: countWords(document.content),
      bytes: new Blob([document.content]).size,
    };
  }, [document]);

  if (!document) {
    return (
      <footer className="statusbar">
        <span className="status-item">{t("status.noDocument")}</span>
      </footer>
    );
  }

  const line = cursor?.line ?? document.cursorLine;
  const col = cursor?.col ?? document.cursorCol;
  const selectionLength = cursor?.selectionLength ?? 0;

  const saveState =
    document.external !== "none"
      ? t("status.externalChange")
      : document.dirty
        ? t("status.modified")
        : t("status.saved");

  return (
    <footer className="statusbar">
      <span className="status-item">
        {t("status.line", { line, col })}
        {selectionLength > 0 ? ` (${t("status.selection", { count: selectionLength })})` : ""}
      </span>

      <span className="status-spacer" />

      {stats && <span className="status-item">{t("status.words", { words: stats.words })}</span>}
      {stats && <span className="status-item">{formatBytes(stats.bytes)}</span>}
      {pending && <span className="status-item status-pending" title={t("mermaid.rendering")} />}

      <span className={cx("status-item", document.external !== "none" && "is-warning")}>{saveState}</span>

      <span className="status-item" title={t("settings.defaultEol")}>
        {document.eol.toUpperCase()}
      </span>
      <span className="status-item" title={t("settings.defaultEncoding")}>
        {document.encoding}
        {document.bom ? " BOM" : ""}
      </span>
      <span className="status-item">{document.readOnly ? t("status.readOnly") : "Markdown"}</span>
    </footer>
  );
}
