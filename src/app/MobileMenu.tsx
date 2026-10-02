/**
 * The Android shell: the document's name, one action button, one menu.
 *
 * The desktop menu bar is deliberately absent — a phone has no room for six
 * drop-downs, and most of what they contain (workspace, outline, split panes,
 * zoom) has no meaning here. What remains is arranged so the common actions
 * are one tap away, while switching to the source text — a writing tool rather
 * than a reading one — sits one level deeper, under *More*.
 */

import { useEffect, useRef, useState } from "react";

import { useUiStore } from "@/app/uiStore";
import { pickAndOpenOnMobile } from "@/app/mobileDocuments";
import { exportHtml, printDocument } from "@/preview/exportActions";
import { useDocumentsStore } from "@/tabs/documentsStore";
import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";

interface MobileMenuProps {
  /** True while the source text is on screen instead of the rendered view. */
  sourceVisible: boolean;
  onToggleSource: () => void;
}

interface MobileEntry {
  /** Absent only for a separator, which has nothing to say. */
  label?: string;
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  /** Rows revealed by this one, used for the nested groups. */
  items?: MobileEntry[];
}

/** Fire-and-forget wrapper: a menu tap has nowhere to report an error. */
function run(task: () => Promise<unknown>): () => void {
  return () => {
    void task().catch((error) => console.error("Menu action failed", error));
  };
}

export function MobileMenu({ sourceVisible, onToggleSource }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const document = useDocumentsStore(
    (state) => state.documents.find((item) => item.id === state.activeId) ?? null,
  );

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (barRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setExpanded(null);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const close = () => {
    setOpen(false);
    setExpanded(null);
  };

  const entries: MobileEntry[] = [
    { label: t("file.open"), run: run(pickAndOpenOnMobile) },
    { separator: true },
    {
      label: t("file.save"),
      disabled: !document?.path,
      run: run(async () => {
        const store = useDocumentsStore.getState();
        if (store.activeId) await store.save(store.activeId);
      }),
    },
    {
      label: t("file.saveAs"),
      disabled: !document,
      run: run(async () => {
        const store = useDocumentsStore.getState();
        if (store.activeId) await store.save(store.activeId, { saveAs: true });
      }),
    },
    { separator: true },
    {
      label: t("tools.exportGroup"),
      disabled: !document,
      items: [
        { label: t("tools.exportPdf"), run: run(printDocument) },
        { label: t("tools.exportHtml"), run: run(exportHtml) },
      ],
    },
    {
      // The source view is a tool for editing, not for reading, so it lives
      // behind one more level than everything else.
      label: t("mobile.more"),
      items: [
        {
          label: t("mobile.source"),
          checked: sourceVisible,
          run: onToggleSource,
        },
        { label: t("help.about"), run: () => useUiStore.getState().openDialog("about") },
      ],
    },
    { separator: true },
    {
      label: t("file.closeTab"),
      disabled: !document,
      run: run(async () => {
        const store = useDocumentsStore.getState();
        if (store.activeId) await store.requestClose(store.activeId);
      }),
    },
  ];

  return (
    <div className="mobile-bar" ref={barRef}>
      <button
        type="button"
        className="mobile-bar__open"
        onClick={run(pickAndOpenOnMobile)}
        aria-label={t("file.open")}
      >
        <span aria-hidden="true">📂</span>
      </button>

      <div className="mobile-bar__title" title={document?.path ?? ""}>
        {document?.title ?? t("app.name")}
      </div>

      <button
        type="button"
        className={cx("mobile-bar__button", open && "is-open")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("mobile.menu")}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
          setExpanded(null);
        }}
      >
        ☰
      </button>

      {open && (
        <div className="mobile-sheet" role="menu">
          {entries.map((entry, index) =>
            entry.separator ? (
              <div key={`sep-${index}`} className="menu-separator" />
            ) : (
              <MobileRow
                key={`${entry.label}-${index}`}
                entry={entry}
                expanded={entry.label !== undefined && expanded === entry.label}
                onExpand={() => setExpanded(expanded === entry.label ? null : (entry.label ?? null))}
                onClose={close}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

interface MobileRowProps {
  entry: MobileEntry;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}

function MobileRow({ entry, expanded, onExpand, onClose }: MobileRowProps) {
  const hasChildren = (entry.items?.length ?? 0) > 0;

  return (
    <div className="mobile-row-group">
      <button
        type="button"
        className={cx("mobile-row", entry.disabled && "is-disabled")}
        disabled={entry.disabled}
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={() => {
          if (entry.disabled) return;
          if (hasChildren) {
            onExpand();
            return;
          }
          entry.run?.();
          onClose();
        }}
      >
        <span className="mobile-row__check">{entry.checked ? "✓" : ""}</span>
        <span className="mobile-row__label">{entry.label}</span>
        {hasChildren && <span className="mobile-row__arrow">{expanded ? "▾" : "▸"}</span>}
      </button>

      {hasChildren && expanded && (
        <div className="mobile-row-children">
          {entry.items?.map((child, index) => (
            <button
              key={`${child.label}-${index}`}
              type="button"
              className={cx("mobile-row mobile-row--nested", child.disabled && "is-disabled")}
              disabled={child.disabled}
              onClick={() => {
                child.run?.();
                onClose();
              }}
            >
              <span className="mobile-row__check">{child.checked ? "✓" : ""}</span>
              <span className="mobile-row__label">{child.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Placeholder shown while nothing is open. */
export function MobileEmptyState() {
  return (
    <div className="mobile-empty">
      <p className="mobile-empty__title">{t("mobile.emptyTitle")}</p>
      <p className="mobile-empty__hint">{t("mobile.emptyHint")}</p>
      <button type="button" className="mobile-empty__action" onClick={run(pickAndOpenOnMobile)}>
        {t("file.open")}
      </button>
    </div>
  );
}
