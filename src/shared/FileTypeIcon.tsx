/**
 * File-type icons for the five document formats.
 *
 * The large PNG/ICO masters from the brand kit are raster art for the
 * operating-system shell. Inside the application a 16-pixel icon needs a
 * different drawing: no gloss, no micro-text, just the silhouette, the colour
 * and one unambiguous symbol. These are native SVG for exactly that reason.
 */

import type { DocumentKind } from "@/documents/types";

export const FILE_TYPE_COLORS: Record<DocumentKind, string> = {
  markdown: "#e5484d",
  json: "#d97706",
  csv: "#16a34a",
  log: "#0891b2",
  xml: "#7c3aed",
  text: "#6b7280",
};

export const FILE_TYPE_LABELS: Record<DocumentKind, string> = {
  markdown: "MD",
  json: "JSON",
  csv: "CSV",
  log: "LOG",
  xml: "XML",
  text: "TXT",
};

interface FileTypeIconProps {
  kind: DocumentKind;
  /** Edge length in CSS pixels. */
  size?: number;
  className?: string;
  /** Set for a standalone icon; leave unset when a text label follows. */
  title?: string;
}

/**
 * Draw one file icon.
 *
 * The document outline is shared by every kind so a list of mixed files reads
 * as one family; colour and symbol carry the meaning.
 */
export function FileTypeIcon({ kind, size = 16, className, title }: FileTypeIconProps) {
  const color = FILE_TYPE_COLORS[kind];
  const label = FILE_TYPE_LABELS[kind];

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M5 2.5h9.2L19 7.3v14.2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
        fill={color}
        fillOpacity="0.14"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M14 2.8v4.4h4.4" fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
      <Symbol kind={kind} color={color} />
      <text
        x="12"
        y="21.1"
        textAnchor="middle"
        fontSize="5.4"
        fontWeight="700"
        fill={color}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        letterSpacing="0.2"
      >
        {label}
      </text>
    </svg>
  );
}

function Symbol({ kind, color }: { kind: DocumentKind; color: string }) {
  switch (kind) {
    case "markdown":
      return (
        <g fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 11.2v4.2" />
          <path d="M7 11.2l2 2.4 2-2.4v4.2" />
          <path d="M14.4 11.4v3l1.4-1.3" />
          <path d="M14.4 15.6l1.6-1.5" />
        </g>
      );
    case "json":
      return (
        <g fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.3 10.6c-1.1 0-1.6.5-1.6 1.5v1.2c0 1-.5 1.4-1.5 1.4 1 0 1.5.4 1.5 1.4v1.2c0 1 .5 1.5 1.6 1.5" />
          <path d="M14.7 10.6c1.1 0 1.6.5 1.6 1.5v1.2c0 1 .5 1.4 1.5 1.4-1 0-1.5.4-1.5 1.4v1.2c0 1-.5 1.5-1.6 1.5" />
        </g>
      );
    case "csv":
      return (
        <g fill="none" stroke={color} strokeWidth="1.15">
          <rect x="6.6" y="11" width="10.8" height="7.4" rx="0.6" />
          <path d="M6.6 13.5h10.8M6.6 16h10.8M10.2 11v7.4M13.8 11v7.4" />
        </g>
      );
    case "log":
      return (
        <g fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round">
          <circle cx="7.4" cy="11.9" r="0.9" fill={color} />
          <path d="M9.6 11.9h7.2" />
          <circle cx="7.4" cy="14.6" r="0.9" fill={color} />
          <path d="M9.6 14.6h5.4" />
          <circle cx="7.4" cy="17.3" r="0.9" fill={color} />
          <path d="M9.6 17.3h7.2" />
        </g>
      );
    case "xml":
      return (
        <g fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.2 11.6l-2.2 3 2.2 3" />
          <path d="M14.8 11.6l2.2 3-2.2 3" />
          <path d="M12.9 11.2l-1.8 6.8" />
        </g>
      );
    case "text":
    default:
      return (
        <g fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round">
          <path d="M7.4 12h9.2M7.4 14.6h9.2M7.4 17.2h6" />
        </g>
      );
  }
}
