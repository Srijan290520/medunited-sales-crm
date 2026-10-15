import React, { useState } from 'react';
import { User } from '../types';
import { api } from '../services/api';
import { isApiConfigured } from '../config';
import { DemoAccounts } from '../demo/DemoAccounts';

const DEMO = import.meta.env.VITE_DEMO === 'true';

interface LoginViewProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(email, password);
      if (res.error) {
        setError(res.message || 'Login failed. Please check credentials.');
        setPassword('');
      } else {
        setPassword('');
        onLoginSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span className="logo-mark">M</span>
        </div>
        <h1>MedUnited CRM</h1>
        <p className="subtitle">Medpass &amp; Pharmacy sales tracking</p>

        {!isApiConfigured() && (
          <div className="form-error show">
            This app is not connected to its server yet. An admin needs to set <code>apiUrl</code> in <code>config.js</code>.
          </div>
        )}
        {error && <div className="form-error show" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            autoComplete="username"
            required
            maxLength={254}
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            name="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        {DEMO && (
          <DemoAccounts
            onPick={(em, pw) => {
              setEmail(em);
              setPassword(pw);
              setError(null);
            }}
          />
        )}

      </div>
    </div>
  );
};
