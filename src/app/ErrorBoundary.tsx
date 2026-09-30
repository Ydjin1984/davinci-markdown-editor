/**
 * Last-resort boundary for render-time failures.
 *
 * Unsaved text lives in the documents store, not in component state, so a
 * reload of the interface does not lose anything: the recovery screen offers to
 * reload and the session restores the open documents.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "@/shared/i18n";
import { dirtyDocuments } from "@/tabs/documentsStore";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged without document contents, as required for private files.
    console.error("Interface error", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const unsaved = dirtyDocuments().length;

    return (
      <div className="crash-screen">
        <h1>{t("error.crashTitle")}</h1>
        <p>{t("error.crashBody")}</p>
        {unsaved > 0 && <p className="crash-unsaved">{t("dialog.unsavedQuitBody", { count: unsaved })}</p>}
        <pre className="crash-detail">{error.message}</pre>
        <div className="crash-actions">
          <button type="button" className="button primary" onClick={() => window.location.reload()}>
            {t("error.reload")}
          </button>
          <button type="button" className="button" onClick={() => this.setState({ error: null })}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }
}
