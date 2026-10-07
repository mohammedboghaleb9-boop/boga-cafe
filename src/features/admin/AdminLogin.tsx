import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { adminAuth, type SignInResult } from '@/data/api';
import { useAdminSession } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/shared/layout/Header';
import { Logo } from '@/shared/layout/Logo';
import { Field } from '@/shared/ui/bits';
import { ROLES, type Role } from './permissions';
import { usePageTitle } from '@/shared/layout/usePageTitle';

/** Prototype: pick a role, public demo password. Live site: the admin's own Supabase account. */
export function AdminLogin() {
  const { t } = useI18n();
  usePageTitle(t.admin.loginTitle);
  const demoPassword = adminAuth.demoPassword;
  return (
    <main className="admin-login">
      <div className="panel stack admin-login-card">
        <div className="spread">
          <Logo to="/" />
          <LanguageSwitcher />
        </div>
        <h1 className="admin-login-title">{t.admin.loginTitle}</h1>
        {demoPassword !== undefined ? <DemoForm password={demoPassword} /> : <LiveForm />}
        <Link to="/" className="small muted">
          <span className="dir-arrow" aria-hidden="true">←</span> {t.admin.viewSite}
        </Link>
      </div>
    </main>
  );
}

function DemoForm({ password: demoPassword }: { password: string }) {
  const { t } = useI18n();
  const [role, setRole] = useState<Role>('owner');
  const [password, setPassword] = useState(demoPassword);
  const [error, setError] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError((await adminAuth.signIn({ role, password })) !== 'ok');
  }

  return (
    <form className="stack" onSubmit={submit}>
      <p className="small muted">{fmt(t.admin.loginText, { pwd: demoPassword })}</p>
      <Field label={t.admin.role} htmlFor="login-role">
        <select id="login-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t.admin.roles[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.admin.password} htmlFor="login-password" error={error ? t.admin.wrongPassword : undefined}>
        <input
          id="login-password"
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
        />
      </Field>
      <button type="submit" className="btn btn-primary btn-block">
        {t.admin.signIn}
      </button>
    </form>
  );
}

type Refusal = Exclude<SignInResult, 'ok' | 'denied'>;

function LiveForm() {
  const { t } = useI18n();
  const session = useAdminSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const message: Record<Refusal, string> = {
    credentials: t.admin.signInFailed,
    too_many: t.admin.tooManyAttempts,
    server: t.admin.signInServer,
  };
  // a kept session that could not be checked (no connection): said, with "try again", until the next try
  const unchecked = !error && session.state === 'signed_out' && session.problem === 'server';
  const shown = error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await adminAuth.signIn({ email, password });
    setBusy(false);
    // 'ok' and 'denied' change the session: the panel or the "no access" page replaces this form
    if (r !== 'ok' && r !== 'denied') {
      setError(r);
      setPassword('');
      requestAnimationFrame(() => document.getElementById(r === 'credentials' ? 'login-email' : 'login-error')?.focus());
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <p className="small muted">{t.admin.loginTextLive}</p>
      <Field label={t.admin.email} htmlFor="login-email">
        <input
          id="login-email"
          className="input"
          type="email"
          autoComplete="username"
          dir="ltr"
          maxLength={254}
          value={email}
          aria-invalid={shown === 'credentials'}
          aria-describedby={shown ? 'login-error' : undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label={t.admin.password} htmlFor="login-password">
        <input
          id="login-password"
          className="input"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          maxLength={200}
          value={password}
          aria-invalid={shown === 'credentials'}
          aria-describedby={shown ? 'login-error' : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {shown && (
        <p id="login-error" className="notice notice-bad small" role="alert" tabIndex={-1}>
          {message[shown]}
        </p>
      )}
      {unchecked && (
        <div className="notice notice-warn small stack" role="alert">
          <p>{t.admin.sessionCheckFailed}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={adminAuth.retry}>
            {t.common.retry}
          </button>
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" aria-disabled={busy || undefined}>
        {busy ? t.common.loading : t.admin.signIn}
      </button>
    </form>
  );
}
