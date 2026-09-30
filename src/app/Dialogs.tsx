/** About, keyboard-shortcut and preview-access dialogs. */

import { useEffect, useState } from "react";
import * as ipc from "@/shared/ipc";
import { t } from "@/shared/i18n";
import type { AppInfo } from "@/shared/types";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

const SHORTCUTS: Array<[string, string]> = [
  [t("shortcut.open"), `${mod}+O`],
  [t("shortcut.openFolder"), `${mod}+Shift+O`],
  [t("shortcut.new"), `${mod}+N`],
  [t("shortcut.save"), `${mod}+S`],
  [t("shortcut.saveAs"), `${mod}+Shift+S`],
  [t("shortcut.find"), `${mod}+F`],
  [t("shortcut.replace"), `${mod}+H`],
  [t("shortcut.bold"), `${mod}+B`],
  [t("shortcut.italic"), `${mod}+I`],
  [t("shortcut.undo"), `${mod}+Z`],
  [t("shortcut.redo"), `${mod}+Shift+Z`],
  [t("shortcut.closeTab"), `${mod}+W`],
  [t("view.togglePreview"), `${mod}+Shift+V`],
  [t("shortcut.settings"), `${mod}+,`],
];

export function AboutDialog() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void ipc
      .appInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  return (
    <div className="dialog-body">
      <div className="about-hero">
        <div className="about-mark">M↓</div>
        <div>
          <h2>{t("app.name")}</h2>
          <p>{info ? t("about.version", { version: info.version }) : "…"}</p>
        </div>
      </div>

      <dl className="about-grid">
        <dt>{t("about.runtime")}</dt>
        <dd>{info ? `Tauri ${info.tauriVersion} · ${info.os}/${info.arch}` : "…"}</dd>
        <dt>{t("about.configDir")}</dt>
        <dd className="mono">{info?.configDir ?? "…"}</dd>
      </dl>
    </div>
  );
}

export function ShortcutsDialog() {
  return (
    <div className="dialog-body">
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map(([label, keys]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>
                <kbd>{keys}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Shows which directories the preview is allowed to read images from.
 *
 * Making this visible is deliberate: the user can confirm at a glance that
 * opening a document did not grant access to anything else.
 */
export function AssetAccessDialog() {
  const [roots, setRoots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ipc
      .assetAccess()
      .then((access) => setRoots(access.roots))
      .catch((failure) => setError(String(failure)));
  }, []);

  return (
    <div className="dialog-body">
      <p className="dialog-note">
        The preview can only load images from the locations listed below — the folder of each open document
        and the open workspace. Everything else is refused before it is read from disk.
      </p>

      {error && <p className="dialog-error">{error}</p>}
      {roots && roots.length === 0 && <p className="dialog-note">No locations are currently allowed.</p>}
      {roots && roots.length > 0 && (
        <ul className="path-list">
          {roots.map((root) => (
            <li key={root} className="mono">
              {root}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
