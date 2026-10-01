/** About, keyboard-shortcut and preview-access dialogs. */

import { useEffect, useState } from "react";
import logoUrl from "@/assets/logo.png";
import donationQrUrl from "@/assets/donation-qr.png";
import * as ipc from "@/shared/ipc";
import { copyText } from "@/shared/clipboard";
import { t } from "@/shared/i18n";
import { useUiStore } from "@/app/uiStore";
import type { AppInfo } from "@/shared/types";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

/** Publisher details, mirrored in the installer metadata in tauri.conf.json. */
const PUBLISHER = {
  name: "DaVinci Cyber Engineering",
  website: "https://www.davinci-cyber-engineering.uz/",
  email: "info@davinci-cyber-engineering.uz",
  donation: {
    network: "TRC20 (TRON)",
    asset: "USDT",
    address: "TAnJB15jGXVtfKkwgs2pz5NFN5fN22ha41",
  },
} as const;

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
  [t("tools.exportPdf"), `${mod}+P`],
  [t("tools.exportHtml"), `${mod}+Shift+E`],
  [t("view.togglePreview"), `${mod}+Shift+V`],
  [t("shortcut.settings"), `${mod}+,`],
];

/** Open a link outside the application, reporting a refusal to the user. */
function openLink(url: string): void {
  void ipc.openExternalUrl(url).catch((error: unknown) => {
    useUiStore.getState().notify(error instanceof Error ? error.message : String(error), "error");
  });
}

export function AboutDialog() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void ipc
      .appInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="dialog-body about">
      <header className="about-hero">
        <img className="about-logo" src={logoUrl} alt={PUBLISHER.name} width={84} height={84} />
        <div className="about-identity">
          <h2>{t("app.name")}</h2>
          <p className="about-version">{info ? t("about.version", { version: info.version }) : "…"}</p>
          <p className="about-publisher">{PUBLISHER.name}</p>
          <p className="about-tagline">{t("about.tagline")}</p>
        </div>
      </header>

      <section className="about-section">
        <h3>{t("about.contact")}</h3>
        <dl className="about-grid">
          <dt>{t("about.website")}</dt>
          <dd>
            <button type="button" className="link-button" onClick={() => openLink(PUBLISHER.website)}>
              {PUBLISHER.website}
            </button>
          </dd>
          <dt>{t("about.email")}</dt>
          <dd>
            <button
              type="button"
              className="link-button"
              onClick={() => openLink(`mailto:${PUBLISHER.email}`)}
            >
              {PUBLISHER.email}
            </button>
          </dd>
        </dl>
      </section>

      <section className="about-section">
        <h3>{t("about.donate")}</h3>
        <div className="about-donate">
          <img className="about-qr" src={donationQrUrl} alt={t("about.qrAlt")} width={168} height={167} />
          <div className="about-donate-details">
            <dl className="about-grid">
              <dt>{t("about.network")}</dt>
              <dd>
                {PUBLISHER.donation.asset} · {PUBLISHER.donation.network}
              </dd>
            </dl>
            <p className="about-address-label">{t("about.address")}</p>
            <code className="about-address">{PUBLISHER.donation.address}</code>
            <div className="about-donate-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  void copyText(PUBLISHER.donation.address).then((ok) => {
                    setCopied(ok);
                    useUiStore
                      .getState()
                      .notify(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : "error");
                  });
                }}
              >
                {copied ? t("code.copied") : t("about.copyAddress")}
              </button>
            </div>
            <p className="about-note">{t("about.scanHint")}</p>
            <p className="about-note">{t("about.donateNote")}</p>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h3>{t("about.runtime")}</h3>
        <dl className="about-grid">
          <dt>Runtime</dt>
          <dd>{info ? `Tauri ${info.tauriVersion} · ${info.os}/${info.arch}` : "…"}</dd>
          <dt>{t("about.configDir")}</dt>
          <dd className="mono about-path">{info?.configDir ?? "…"}</dd>
        </dl>
        <p className="about-note">{t("about.license")}</p>
      </section>
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
        and its parent folders, plus the open workspace. Everything else is refused before it is read from
        disk.
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
