import React, { useState } from 'react';
import { User } from '../types';
import { api } from '../services/api';

interface ChangePasswordViewProps {
  user: User;
  required: boolean; // first login / after an admin reset: can't skip
  onDone: (user: User) => void;
  onCancel: () => void;
  onLogout: () => void;
}

// Mirrors the server rules (validatePasswordStrength in Auth.gs) so people
// see problems before they submit. The server still checks everything.
function passwordProblems(pw: string, email: string): string[] {
  const out: string[] = [];
  if (pw.length < 10) out.push('At least 10 characters');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) out.push('Letters and numbers');
  const local = email.split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) out.push('Must not contain your email name');
  return out;
}

export const ChangePasswordView: React.FC<ChangePasswordViewProps> = ({ user, required, onDone, onCancel, onLogout }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const problems = passwordProblems(next, user.Email);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (problems.length) return setError('New password needs: ' + problems.join(', ') + '.');
    if (next !== confirm) return setError('The two new passwords do not match.');
    setSaving(true);
    const res = await api.changePassword(current, next);
    setSaving(false);
    if (res.error) {
      setError(res.message || 'Could not change password.');
      return;
    }
    onDone(res.user);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span className="logo-mark">M</span>
        </div>
        <h1>{required ? 'Set your password' : 'Change password'}</h1>
        <p className="subtitle">
          {required
            ? `Welcome, ${user.Name}. Your account was set up with a temporary password — choose your own to continue.`
            : 'Changing your password signs you out on every other device.'}
        </p>

        {error && <div className="form-error show" role="alert">{error}</div>}

        <form onSubmit={submit}>
          <input type="email" autoComplete="username" value={user.Email} readOnly aria-hidden="true" tabIndex={-1} style={{ display: "none" }} />
          <label htmlFor="cp-current">{required ? 'Temporary password' : 'Current password'}</label>
          <input id="cp-current" type="password" autoComplete="current-password" required maxLength={128}
            value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />

          <label htmlFor="cp-new">New password</label>
          <input id="cp-new" type="password" autoComplete="new-password" required maxLength={128}
            value={next} onChange={(e) => setNext(e.target.value)} />
          {next && problems.length > 0 && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: -8, marginBottom: 12 }}>
              Needs: {problems.join(' · ')}
            </div>
          )}

          <label htmlFor="cp-confirm">Confirm new password</label>
          <input id="cp-confirm" type="password" autoComplete="new-password" required maxLength={128}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />

          <button type="submit" disabled={saving} style={{ width: '100%', justifyContent: 'center' }}>
            {saving ? 'Saving…' : 'Save new password'}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          {required ? (
            <button type="button" className="secondary" onClick={onLogout}>Log out</button>
          ) : (
            <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
};
