import React, { useEffect, useRef, useState } from 'react';
import { User, ToastMessage, ModuleInfo } from './types';
import { BUILT_IN_MODULES, isModulePage } from './modules';
import { api, hasSession, AUTH_EXPIRED_EVENT, PASSWORD_CHANGE_EVENT } from './services/api';
import { Sidebar, ActivePage } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { SalesView } from './components/SalesView';
import { RemindersView } from './components/RemindersView';
import { SettingsPage } from './components/SettingsPage';
import { IncentivesView } from './components/IncentivesView';
import { PerformanceView } from './components/PerformanceView';
import { isTeamRole } from './utils/roles';
import { LoginView } from './components/LoginView';
import { ChangePasswordView } from './components/ChangePasswordView';
import { Toast } from './components/Toast';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState<boolean>(hasSession());
  const [changingPassword, setChangingPassword] = useState<boolean>(false);
  const [activePage, setActivePage] = useState<ActivePage>('dashboard');
  // Sales modules, as the server lists them.
  const [modules, setModules] = useState<ModuleInfo[]>(BUILT_IN_MODULES);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const lastExpiryToast = useRef<number>(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('medunited_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const addToast = (text: string, type: 'error' | 'success' = 'error') => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === 'error' ? 7000 : 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Restore the session after a page reload (the token is in sessionStorage).
  useEffect(() => {
    if (!hasSession()) return;
    api.me().then((res) => {
      if (!res.error) setCurrentUser(res.user);
      setCheckingSession(false);
    });
  }, []);

  // The server ended the session (expired, deactivated, password reset...).
  useEffect(() => {
    const onExpired = (e: Event) => {
      // Several requests can fail at once; tell the user only once.
      if (Date.now() - lastExpiryToast.current > 5000) {
        lastExpiryToast.current = Date.now();
        addToast(String((e as CustomEvent).detail || 'Your session has ended. Please log in again.'), 'error');
      }
      setCurrentUser(null);
      setChangingPassword(false);
      setActivePage('dashboard');
    };
    const onMustChange = () => setCurrentUser((prev) => (prev ? { ...prev, MustChangePassword: true } : prev));
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    window.addEventListener(PASSWORD_CHANGE_EVENT, onMustChange);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
      window.removeEventListener(PASSWORD_CHANGE_EVENT, onMustChange);
    };
  }, []);

  const handleToggleDesktopCollapse = () => {
    setDesktopCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('medunited_sidebar_collapsed', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleDesktopCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    setChangingPassword(false);
    setActivePage('dashboard');
    addToast('Logged out successfully', 'success');
  };

  // Hooks must all run before the early returns below.
  // Which sales modules exist (Medpass, Pharmacy, Homekare, …) comes from the server.
  useEffect(() => {
    if (!currentUser || currentUser.MustChangePassword) return;
    api.getModules().then((res) => {
      if (!res.error && Array.isArray(res.modules) && res.modules.length) setModules(res.modules);
    });
  }, [currentUser]);

  if (checkingSession) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <span className="logo-mark">M</span>
          <p className="subtitle" style={{ marginTop: 16 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginView
          onLoginSuccess={(u) => {
            setCurrentUser(u);
            setActivePage('dashboard');
            if (!u.MustChangePassword) addToast(`Welcome back, ${u.Name}!`, 'success');
          }}
        />
        <Toast toasts={toasts} onDismiss={removeToast} />
      </>
    );
  }

  if (currentUser.MustChangePassword || changingPassword) {
    return (
      <>
        <ChangePasswordView
          user={currentUser}
          required={!!currentUser.MustChangePassword}
          onDone={(u) => {
            setCurrentUser(u);
            setChangingPassword(false);
            addToast('Password updated', 'success');
          }}
          onCancel={() => setChangingPassword(false)}
          onLogout={handleLogout}
        />
        <Toast toasts={toasts} onDismiss={removeToast} />
      </>
    );
  }

  const pageTitles: Record<ActivePage, string> = {
    dashboard: 'Dashboard',
    medpass: 'Medpass Sales',
    pharmacy: 'Pharmacy Sales',
    homekare: 'Homekare',
    lab: 'Lab & Radiology',
    reminders: 'Reminders',
    performance: 'Performance',
    incentives: 'Incentives',
    settings: 'Settings',
    users: 'Settings',
  };

  return (
    <div className={`app-shell ${desktopCollapsed ? 'desktop-collapsed' : ''}`}>
      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        user={currentUser}
        modules={modules}
        activePage={activePage}
        onNavigate={(p) => {
          setActivePage(p);
          setMobileMenuOpen(false);
        }}
        onLogout={handleLogout}
        onChangePassword={() => setChangingPassword(true)}
        isOpenMobile={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        isCollapsedDesktop={desktopCollapsed}
        onToggleDesktopCollapse={handleToggleDesktopCollapse}
      />

      <div className="main-col">
        {/* Mobile Top Header Bar */}
        <header className="mobile-header">
          <div className="mobile-header-left">
            <button
              type="button"
              className="mobile-hamburger-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <div className="mobile-brand-group">
              <span className="logo-mark">M</span>
              <span className="brand-name">MedUnited</span>
            </div>
          </div>

          <div className="mobile-header-right">
            <span className="mobile-page-tag">{pageTitles[activePage]}</span>
            <div
              className="mobile-avatar"
              title={`${currentUser.Name} (${currentUser.Role})`}
              onClick={() => setMobileMenuOpen(true)}
            >
              {currentUser.Name.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {activePage === 'dashboard' && <Dashboard user={currentUser} onToast={addToast} onNavigate={setActivePage} />}

        {isModulePage(activePage) && (
          <SalesView
            key={activePage}
            type={activePage}
            moduleInfo={modules.find((m) => m.id === activePage)}
            user={currentUser}
            onToast={addToast}
          />
        )}

        {activePage === 'reminders' && <RemindersView user={currentUser} onToast={addToast} />}

        {activePage === 'performance' && <PerformanceView user={currentUser} onToast={addToast} />}

        {/* Incentives and Settings are for managers and above (the server checks too). */}
        {activePage === 'incentives' && isTeamRole(currentUser.Role) && <IncentivesView user={currentUser} onToast={addToast} />}

        {(activePage === 'settings' || activePage === 'users') && isTeamRole(currentUser.Role) && <SettingsPage user={currentUser} onToast={addToast} />}

      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="mobile-bottom-nav">
        <button
          type="button"
          className={`mobile-tab-btn ${activePage === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActivePage('dashboard')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          </svg>
          <span>Dashboard</span>
        </button>

        <button
          type="button"
          className={`mobile-tab-btn ${activePage === 'medpass' ? 'active' : ''}`}
          onClick={() => setActivePage('medpass')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <span>Medpass</span>
        </button>

        <button
          type="button"
          className={`mobile-tab-btn ${activePage === 'pharmacy' ? 'active' : ''}`}
          onClick={() => setActivePage('pharmacy')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="7" width="15" height="11" rx="1.5"></rect>
            <path d="M16 10h3.5L22 13.5V18h-6"></path>
            <circle cx="6" cy="19.5" r="1.7"></circle>
            <circle cx="17.5" cy="19.5" r="1.7"></circle>
          </svg>
          <span>Pharmacy</span>
        </button>

        <button
          type="button"
          className={`mobile-tab-btn ${activePage === 'reminders' ? 'active' : ''}`}
          onClick={() => setActivePage('reminders')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span>Reminders</span>
        </button>

        <button
          type="button"
          className={`mobile-tab-btn ${mobileMenuOpen || activePage === 'settings' || activePage === 'users' || activePage === 'incentives' ? 'active' : ''}`}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
          <span>More</span>
        </button>
      </nav>

      <Toast toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};

export default App;
