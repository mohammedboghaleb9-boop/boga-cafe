import { Component, type ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { usePageTitle } from '@/shared/layout/usePageTitle';

/** What /admin shows when the panel could not be opened (see AdminErrorBoundary). */
function AdminLoadFailed() {
  const { t } = useI18n();
  usePageTitle(t.admin.loadFailedTitle);
  return (
    <main id="main" className="container page stack">
      <h1>{t.admin.loadFailedTitle}</h1>
      <p className="lead" role="alert">
        {t.admin.loadFailedText}
      </p>
      {/* A reload, not a second import(). General knowledge, not tested here: a browser can keep the result of a failed
          dynamic import for the life of the page, and after a deploy an old tab names files that no longer exist,
          which only a fresh index.html corrects. What the browser test does check: with the file available again,
          this reload opens the panel. */}
      <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => window.location.reload()}>
        {t.common.retry}
      </button>
    </main>
  );
}

/**
 * Around the lazily loaded Admin Panel only (src/app/App.tsx): a chunk that fails to load (an old tab after a
 * deploy, a lost connection) or a crash inside the panel shows a message and a retry here, not a blank page.
 * The shop's routes are outside it and do not change.
 */
export class AdminErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <AdminLoadFailed /> : this.props.children;
  }
}
