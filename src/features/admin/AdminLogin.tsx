import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { fmt, useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/shared/layout/Header';
import { Logo } from '@/shared/layout/Logo';
import { Field } from '@/shared/ui/bits';
import { ROLES, type Role } from './permissions';
import { DEMO_PASSWORD, adminSession } from './session';

export function AdminLogin() {
  const { t } = useI18n();
  const [role, setRole] = useState<Role>('owner');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== DEMO_PASSWORD) return setError(true);
    adminSession.signIn(role);
  }

  return (
    <div className="admin-login">
      <form className="panel stack admin-login-card" onSubmit={submit}>
        <div className="spread">
          <Logo to="/" />
          <LanguageSwitcher />
        </div>
        <h1 className="admin-login-title">{t.admin.loginTitle}</h1>
        <p className="small muted">{fmt(t.admin.loginText, { pwd: DEMO_PASSWORD })}</p>
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
        <Link to="/" className="small muted">
          <span className="dir-arrow" aria-hidden="true">←</span> {t.admin.viewSite}
        </Link>
      </form>
    </div>
  );
}
