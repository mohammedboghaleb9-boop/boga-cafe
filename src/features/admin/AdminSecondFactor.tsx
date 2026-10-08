import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { adminAuth, type CodeResult, type TotpSetup } from '@/data/api';
import { useAdminSession } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/shared/layout/Header';
import { Logo } from '@/shared/layout/Logo';
import { usePageTitle } from '@/shared/layout/usePageTitle';
import { Field } from '@/shared/ui/bits';

type Refusal = Exclude<CodeResult, 'ok' | 'denied'>;

/**
 * Live site, past the password (aal1): the authenticator app's code, after setting the
 * app up when the account has none (src/data/supabase/adminAuth.ts). The setup's QR code
 * and secret live in this screen's state only, and are gone once it closes.
 */
export function AdminSecondFactor() {
  const { t } = useI18n();
  usePageTitle(t.admin.secondFactorTitle);
  const session = useAdminSession();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [problem, setProblem] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const enrolled = session.state === 'second_factor' && session.enrolled;
  const message: Record<Refusal, string> = {
    wrong_code: t.admin.wrongCode,
    too_many: t.admin.tooManyAttempts,
    server: t.admin.signInServer,
  };

  async function startSetup() {
    if (busy || !adminAuth.secondFactor) return;
    setBusy(true);
    setProblem(null);
    const r = await adminAuth.secondFactor.setUp();
    setBusy(false);
    if (typeof r === 'string') setProblem(r);
    else setSetup(r);
  }

  return (
    <main className="admin-login">
      <div className="panel stack admin-login-card">
        <div className="spread">
          <Logo to="/" />
          <LanguageSwitcher />
        </div>
        <h1 className="admin-login-title">{t.admin.secondFactorTitle}</h1>
        {enrolled || setup ? (
          <>
            {setup && <SetupCode setup={setup} />}
            <CodeForm onRefused={setProblem} problem={problem && message[problem]} />
          </>
        ) : (
          <>
            <p className="small muted">{t.admin.setUpIntro}</p>
            {problem && (
              <p id="factor-error" className="notice notice-bad small" role="alert">
                {message[problem]}
              </p>
            )}
            <button type="button" className="btn btn-primary btn-block" aria-disabled={busy || undefined} onClick={startSetup}>
              {busy ? t.common.loading : t.admin.setUpStart}
            </button>
          </>
        )}
        {enrolled && <p className="small muted">{t.admin.lostPhone}</p>}
        <button type="button" className="btn btn-ghost btn-block" onClick={() => void adminAuth.signOut()}>
          {t.admin.signOut}
        </button>
        <Link to="/" className="small muted">
          <span className="dir-arrow" aria-hidden="true">←</span> {t.admin.viewSite}
        </Link>
      </div>
    </main>
  );
}

/** The new app's QR code and its secret as text: shown once, during this setup only. */
function SetupCode({ setup }: { setup: TotpSetup }) {
  const { t } = useI18n();
  // groups of 4 are easier to type into an app; the app ignores the spaces
  const key = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  return (
    <div className="stack">
      <p className="small">{t.admin.setUpScan}</p>
      <img className="totp-qr" src={setup.qrCode} alt={t.admin.qrAlt} width={180} height={180} />
      <div className="field">
        <span className="small muted">{t.admin.setUpKey}</span>
        <code className="totp-key" dir="ltr">
          {key}
        </code>
      </div>
      <p className="small muted">{t.admin.setUpBackup}</p>
      <p className="small">{t.admin.setUpConfirm}</p>
    </div>
  );
}

function CodeForm({ onRefused, problem }: { onRefused: (r: Refusal | null) => void; problem: string | null }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !adminAuth.secondFactor) return;
    setBusy(true);
    onRefused(null);
    const r = await adminAuth.secondFactor.verify(code);
    setBusy(false);
    // 'ok' and 'denied' change the session: the panel or the "no access" page replaces this screen
    if (r !== 'ok' && r !== 'denied') {
      onRefused(r);
      setCode('');
      requestAnimationFrame(() => document.getElementById('factor-code')?.focus());
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label={t.admin.code} htmlFor="factor-code" hint={t.admin.codePrompt}>
        <input
          id="factor-code"
          className="input totp-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          maxLength={7}
          value={code}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? 'factor-error' : undefined}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        />
      </Field>
      {problem && (
        <p id="factor-error" className="notice notice-bad small" role="alert" tabIndex={-1}>
          {problem}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" aria-disabled={busy || undefined}>
        {busy ? t.common.loading : t.admin.verifyCode}
      </button>
    </form>
  );
}
