/**
 * Rendered preview of a non-Markdown document.
 *
 * The Markdown preview keeps its HTML pipeline; every other kind is handed to
 * its format module. A kind without a module still shows its source, so opening
 * an unknown text file never produces an empty pane — and it can be re-read as
 * one of the known formats without renaming the file.
 */

import { t } from "@/shared/i18n";
import { formatModule } from "@/formats";
import { SourceView, ViewerMessage } from "@/formats/shared";
import { DOCUMENT_TYPES, descriptorFor } from "@/documents/registry";
import { suggestKindFromContent } from "@/documents/detect";
import type { DocumentKind } from "@/documents/types";

export interface DocumentPreviewProps {
  kind: DocumentKind;
  content: string;
  documentId: string;
  revision: number;
  appearance: "light" | "dark";
  onJumpToLine: (line: number, column?: number) => void;
  onReplaceContent?: (text: string) => void;
  /** Re-interpret a plain text document as one of the structured formats. */
  onKindChange?: (kind: DocumentKind) => void;
}

export function DocumentPreview({
  kind,
  content,
  documentId,
  revision,
  appearance,
  onJumpToLine,
  onReplaceContent,
  onKindChange,
}: DocumentPreviewProps) {
  const module = formatModule(kind);

  if (module) {
    const Viewer = module.Viewer;
    return (
      <Viewer
        key={documentId}
        content={content}
        documentId={documentId}
        revision={revision}
        appearance={appearance}
        onJumpToLine={onJumpToLine}
        onReplaceContent={onReplaceContent}
      />
    );
  }

  if (kind === "text") {
    const suggestion = suggestKindFromContent(content);
    return (
      <div className="format-preview-plain">
        <div className="format-preview-hint">
          <span>{t("documents.unknownHint")}</span>
          <label className="format-preview-kind">
            {t("documents.interpretAs")}
            <select value={kind} onChange={(event) => onKindChange?.(event.target.value as DocumentKind)}>
              {DOCUMENT_TYPES.map((descriptor) => (
                <option key={descriptor.kind} value={descriptor.kind}>
                  {t(descriptor.labelKey)}
                </option>
              ))}
            </select>
          </label>
          {suggestion && suggestion !== kind ? (
            <span className="format-preview-suggestion">
              {t("documents.looksLike", { kind: t(descriptorFor(suggestion).labelKey) })}
            </span>
          ) : null}
        </div>
        <SourceView content={content} onJumpToLine={onJumpToLine} />
      </div>
    );
  }

  return <ViewerMessage title={t("viewer.invalid")}>{t("documents.unknownHint")}</ViewerMessage>;
}
