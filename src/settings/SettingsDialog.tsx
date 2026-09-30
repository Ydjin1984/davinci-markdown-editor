/** Settings dialog, grouped by the categories from the specification. */

import { useEffect, useState } from "react";
import { useSettingsStore } from "./settingsStore";
import * as ipc from "@/shared/ipc";
import { t } from "@/shared/i18n";
import { cx } from "@/shared/util";
import type { AppInfo } from "@/shared/types";

type Tab = "editor" | "preview" | "files" | "application";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "editor", label: t("settings.category.editor") },
  { id: "preview", label: t("settings.category.preview") },
  { id: "files", label: t("settings.category.files") },
  { id: "application", label: t("settings.category.application") },
];

export function SettingsDialog() {
  const [tab, setTab] = useState<Tab>("editor");
  const [info, setInfo] = useState<AppInfo | null>(null);

  const settings = useSettingsStore((state) => state.settings);
  const patch = useSettingsStore((state) => state.patch);
  const reset = useSettingsStore((state) => state.reset);

  useEffect(() => {
    if (tab !== "application" || info) return;
    void ipc
      .appInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, [tab, info]);

  return (
    <div className="settings-dialog">
      <nav className="settings-tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={cx("settings-tab", tab === entry.id && "is-active")}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="settings-body">
        {tab === "editor" && (
          <>
            <Field label={t("settings.fontFamily")}>
              <input
                type="text"
                value={settings.editor.fontFamily}
                onChange={(event) => patch("editor", { fontFamily: event.target.value })}
              />
            </Field>
            <Field label={t("settings.fontSize")} hint={`${settings.editor.fontSize}px`}>
              <input
                type="range"
                min={8}
                max={32}
                step={1}
                value={settings.editor.fontSize}
                onChange={(event) => patch("editor", { fontSize: Number(event.target.value) })}
              />
            </Field>
            <Field label={t("settings.lineHeight")} hint={settings.editor.lineHeight.toFixed(2)}>
              <input
                type="range"
                min={1}
                max={2.4}
                step={0.05}
                value={settings.editor.lineHeight}
                onChange={(event) => patch("editor", { lineHeight: Number(event.target.value) })}
              />
            </Field>
            <Field label={t("settings.tabSize")} hint={String(settings.editor.tabSize)}>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={settings.editor.tabSize}
                onChange={(event) => patch("editor", { tabSize: Number(event.target.value) })}
              />
            </Field>
            <Toggle
              label={t("settings.insertSpaces")}
              checked={settings.editor.insertSpaces}
              onChange={(value) => patch("editor", { insertSpaces: value })}
            />
            <Toggle
              label={t("settings.wordWrap")}
              checked={settings.editor.wordWrap}
              onChange={(value) => patch("editor", { wordWrap: value })}
            />
            <Toggle
              label={t("settings.lineNumbers")}
              checked={settings.editor.lineNumbers}
              onChange={(value) => patch("editor", { lineNumbers: value })}
            />
            <Toggle
              label={t("settings.highlightActiveLine")}
              checked={settings.editor.highlightActiveLine}
              onChange={(value) => patch("editor", { highlightActiveLine: value })}
            />
            <Toggle
              label={t("settings.bracketMatching")}
              checked={settings.editor.bracketMatching}
              onChange={(value) => patch("editor", { bracketMatching: value })}
            />
            <Toggle
              label={t("settings.codeFolding")}
              checked={settings.editor.codeFolding}
              onChange={(value) => patch("editor", { codeFolding: value })}
            />
            <Divider />
            <Toggle
              label={t("settings.autosave")}
              checked={settings.editor.autosave.enabled}
              onChange={(value) =>
                patch("editor", { autosave: { ...settings.editor.autosave, enabled: value } })
              }
            />
            <Field label={t("settings.autosaveDelay")} hint={String(settings.editor.autosave.delayMs)}>
              <input
                type="range"
                min={300}
                max={10_000}
                step={100}
                value={settings.editor.autosave.delayMs}
                onChange={(event) =>
                  patch("editor", {
                    autosave: { ...settings.editor.autosave, delayMs: Number(event.target.value) },
                  })
                }
              />
            </Field>
            <Toggle
              label={t("settings.autosaveOnBlur")}
              checked={settings.editor.autosave.onFocusLost}
              onChange={(value) =>
                patch("editor", { autosave: { ...settings.editor.autosave, onFocusLost: value } })
              }
            />
          </>
        )}

        {tab === "preview" && (
          <>
            <Field label={t("settings.previewTheme")}>
              <select
                value={settings.preview.theme}
                onChange={(event) => patch("preview", { theme: event.target.value as never })}
              >
                <option value="system">{t("settings.themeSystem")}</option>
                <option value="light">{t("settings.themeLight")}</option>
                <option value="dark">{t("settings.themeDark")}</option>
              </select>
            </Field>
            <Field label={t("settings.fontSize")} hint={`${settings.preview.fontSize}px`}>
              <input
                type="range"
                min={11}
                max={28}
                step={1}
                value={settings.preview.fontSize}
                onChange={(event) => patch("preview", { fontSize: Number(event.target.value) })}
              />
            </Field>
            <Field label={t("settings.mermaidTheme")}>
              <select
                value={settings.preview.mermaidTheme}
                onChange={(event) => patch("preview", { mermaidTheme: event.target.value as never })}
              >
                <option value="auto">Auto</option>
                <option value="default">Default</option>
                <option value="dark">Dark</option>
                <option value="forest">Forest</option>
                <option value="neutral">Neutral</option>
                <option value="base">Base</option>
              </select>
            </Field>
            <Field label={t("settings.codeTheme")}>
              <select
                value={settings.preview.codeTheme}
                onChange={(event) => patch("preview", { codeTheme: event.target.value })}
              >
                <option value="auto">Auto</option>
                <option value="github-light">GitHub Light</option>
                <option value="github-dark">GitHub Dark</option>
                <option value="one-dark-pro">One Dark Pro</option>
                <option value="vitesse-light">Vitesse Light</option>
                <option value="vitesse-dark">Vitesse Dark</option>
              </select>
            </Field>
            <Divider />
            <Toggle
              label={t("settings.syncScroll")}
              checked={settings.preview.syncScroll}
              onChange={(value) => patch("preview", { syncScroll: value })}
            />
            <Toggle
              label={t("settings.rawHtml")}
              checked={settings.preview.allowRawHtml}
              onChange={(value) => patch("preview", { allowRawHtml: value })}
            />
            <Toggle
              label={t("settings.renderMath")}
              checked={settings.preview.renderMath}
              onChange={(value) => patch("preview", { renderMath: value })}
            />
            <Toggle
              label={t("settings.lineWrapCode")}
              checked={settings.preview.lineWrapCode}
              onChange={(value) => patch("preview", { lineWrapCode: value })}
            />
            <Toggle
              label={t("settings.openExternalLinks")}
              checked={settings.preview.openExternalLinks}
              onChange={(value) => patch("preview", { openExternalLinks: value })}
            />
            <Toggle
              label={t("settings.headingAnchors")}
              checked={settings.preview.headingAnchors}
              onChange={(value) => patch("preview", { headingAnchors: value })}
            />
          </>
        )}

        {tab === "files" && (
          <>
            <Toggle
              label={t("settings.restoreSession")}
              checked={settings.files.restoreSession}
              onChange={(value) => patch("files", { restoreSession: value })}
            />
            <Field label={t("settings.externalChange")}>
              <select
                value={settings.files.externalChange}
                onChange={(event) => patch("files", { externalChange: event.target.value as never })}
              >
                <option value="ask">{t("settings.externalAsk")}</option>
                <option value="autoReload">{t("settings.externalReload")}</option>
                <option value="keepLocal">{t("settings.externalKeep")}</option>
              </select>
            </Field>
            <Field label={t("settings.defaultEol")}>
              <select
                value={settings.files.defaultEol}
                onChange={(event) => patch("files", { defaultEol: event.target.value as never })}
              >
                <option value="lf">LF</option>
                <option value="crlf">CRLF</option>
                <option value="preserve">Preserve</option>
              </select>
            </Field>
            <Field label={t("settings.defaultEncoding")}>
              <select
                value={settings.files.defaultEncoding}
                onChange={(event) => patch("files", { defaultEncoding: event.target.value })}
              >
                {[
                  "UTF-8",
                  "windows-1251",
                  "windows-1252",
                  "KOI8-R",
                  "UTF-16LE",
                  "UTF-16BE",
                  "Shift_JIS",
                  "GBK",
                ].map((encoding) => (
                  <option key={encoding} value={encoding}>
                    {encoding}
                  </option>
                ))}
              </select>
            </Field>
            <Divider />
            <Toggle
              label={t("settings.showIgnored")}
              checked={settings.files.showIgnored}
              onChange={(value) => patch("files", { showIgnored: value })}
            />
            <Toggle
              label={t("settings.confirmDelete")}
              checked={settings.files.confirmDelete}
              onChange={(value) => patch("files", { confirmDelete: value })}
            />
            <Divider />
            <Field label={t("file.clearRecent")}>
              <button type="button" className="button" onClick={() => void ipc.clearRecent()}>
                {t("file.clearRecent")}
              </button>
            </Field>
          </>
        )}

        {tab === "application" && (
          <>
            <Field label={t("settings.appTheme")}>
              <select
                value={settings.application.theme}
                onChange={(event) => patch("application", { theme: event.target.value as never })}
              >
                <option value="system">{t("settings.themeSystem")}</option>
                <option value="light">{t("settings.themeLight")}</option>
                <option value="dark">{t("settings.themeDark")}</option>
              </select>
            </Field>
            <Field label={t("settings.language")}>
              <select
                value={settings.application.language}
                onChange={(event) => patch("application", { language: event.target.value })}
              >
                <option value="system">{t("settings.languageSystem")}</option>
                <option value="en">English</option>
                <option value="ru">Русский</option>
              </select>
            </Field>
            <Field label={t("settings.zoom")} hint={`${Math.round(settings.application.zoom * 100)}%`}>
              <input
                type="range"
                min={0.6}
                max={2}
                step={0.05}
                value={settings.application.zoom}
                onChange={(event) => patch("application", { zoom: Number(event.target.value) })}
              />
            </Field>
            <Divider />
            <Toggle label={t("settings.telemetry")} checked={false} disabled onChange={() => undefined} />

            {info && (
              <>
                <Divider />
                <dl className="about-grid">
                  <dt>{t("about.version")}</dt>
                  <dd>
                    {info.name} {info.version}
                  </dd>
                  <dt>{t("about.runtime")}</dt>
                  <dd>
                    Tauri {info.tauriVersion} · {info.os}/{info.arch}
                  </dd>
                  <dt>{t("about.configDir")}</dt>
                  <dd className="mono">{info.configDir}</dd>
                </dl>
              </>
            )}
          </>
        )}
      </div>

      <footer className="settings-footer">
        <button
          type="button"
          className="button"
          onClick={async () => {
            const confirmed = await ipc.confirmDialog(t("settings.reset"), t("settings.resetConfirm"), {
              kind: "warning",
              buttons: "okCancel",
              okLabel: t("settings.reset"),
              cancelLabel: t("common.cancel"),
            });
            if (confirmed) await reset();
          }}
        >
          {t("settings.reset")}
        </button>
      </footer>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="settings-field">
      <span className="settings-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <span className="settings-control">{children}</span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={cx("settings-field", "settings-toggle", disabled && "is-disabled")}>
      <span className="settings-label">{label}</span>
      <span className="settings-control">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </span>
    </label>
  );
}

function Divider() {
  return <hr className="settings-divider" />;
}
