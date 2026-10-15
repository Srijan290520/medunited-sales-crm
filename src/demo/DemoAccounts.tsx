import React from 'react';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demoBackend';

// Preview build only: quick sign-in buttons for the sample accounts.
export const DemoAccounts: React.FC<{ onPick: (email: string, password: string) => void }> = ({ onPick }) => (
  <div className="demo-accounts">
    <div className="demo-banner">
      <strong>Preview with sample data.</strong> Everything runs in your browser; nothing is saved and it resets when you reload.
    </div>
    <div className="demo-accounts-label">Sign in as</div>
    <div className="demo-accounts-grid">
      {DEMO_ACCOUNTS.map((a) => (
        <button key={a.email} type="button" className="secondary demo-account" onClick={() => onPick(a.email, a.password || DEMO_PASSWORD)}>
          <span className="demo-account-role">{a.label}</span>
          <span className="demo-account-note">{a.note}</span>
        </button>
      ))}
    </div>
    <div className="demo-accounts-hint">Pick one, then press Log in. Password for the first three: <code>{DEMO_PASSWORD}</code></div>
  </div>
);
