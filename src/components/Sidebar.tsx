import React from 'react';
import { User } from '../types';
import { initials } from '../utils/date';

export type ActivePage = 'dashboard' | 'medpass' | 'pharmacy' | 'reminders' | 'settings' | 'users';

interface SidebarProps {
  user: User;
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
  onLogout: () => void;
  onChangePassword: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  isCollapsedDesktop?: boolean;
  onToggleDesktopCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  activePage,
  onNavigate,
  onLogout,
  onChangePassword,
  isOpenMobile,
  onCloseMobile,
  isCollapsedDesktop,
  onToggleDesktopCollapse,
}) => {
  const canSeeIncentives = user.Role === 'admin' || user.Role === 'manager';
  const canSeeUsers = user.Role === 'admin';

  const handleNav = (p: ActivePage) => {
    onNavigate(p);
    onCloseMobile?.();
  };

  return (
    <aside
      className={`sidebar ${isOpenMobile ? 'mobile-open' : ''} ${isCollapsedDesktop ? 'collapsed' : ''}`}
    >
      <div className="sidebar-brand">
        <div
          className="sidebar-brand-group"
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: isCollapsedDesktop ? 'pointer' : 'default' }}
          onClick={() => {
            if (isCollapsedDesktop) onToggleDesktopCollapse?.();
          }}
          title={isCollapsedDesktop ? "Click to expand sidebar" : undefined}
        >
          <span className="logo-mark">M</span>
          <span className="sidebar-brand-text">MedUnited CRM</span>
        </div>

        {/* Desktop Collapse / Expand Button */}
        {onToggleDesktopCollapse && (
          <button
            type="button"
            className="desktop-collapse-btn"
            onClick={onToggleDesktopCollapse}
            title={isCollapsedDesktop ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
            aria-label={isCollapsedDesktop ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {isCollapsedDesktop ? (
                <>
                  <polyline points="13 17 18 12 13 7"></polyline>
                  <polyline points="6 17 11 12 6 7"></polyline>
                </>
              ) : (
                <>
                  <polyline points="11 17 6 12 11 7"></polyline>
                  <polyline points="18 17 13 12 18 7"></polyline>
                </>
              )}
            </svg>
          </button>
        )}

        {/* Mobile Close Button */}
        {onCloseMobile && (
          <button
            type="button"
            className="mobile-close-btn"
            onClick={onCloseMobile}
            aria-label="Close menu"
          >
            ✕
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        <a
          href="#dashboard"
          className={activePage === 'dashboard' ? 'active' : ''}
          data-tooltip="Dashboard"
          onClick={(e) => {
            e.preventDefault();
            handleNav('dashboard');
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          </svg>
          <span>Dashboard</span>
        </a>

        <a
          href="#medpass"
          className={activePage === 'medpass' ? 'active' : ''}
          data-tooltip="Medpass Sales"
          onClick={(e) => {
            e.preventDefault();
            handleNav('medpass');
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <span>Medpass</span>
        </a>

        <a
          href="#pharmacy"
          className={activePage === 'pharmacy' ? 'active' : ''}
          data-tooltip="Pharmacy Sales"
          onClick={(e) => {
            e.preventDefault();
            handleNav('pharmacy');
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="7" width="15" height="11" rx="1.5"></rect>
            <path d="M16 10h3.5L22 13.5V18h-6"></path>
            <circle cx="6" cy="19.5" r="1.7"></circle>
            <circle cx="17.5" cy="19.5" r="1.7"></circle>
          </svg>
          <span>Pharmacy</span>
        </a>

        <a
          href="#reminders"
          className={activePage === 'reminders' ? 'active' : ''}
          data-tooltip="Refill Reminders"
          onClick={(e) => {
            e.preventDefault();
            handleNav('reminders');
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span>Reminders</span>
        </a>

        {canSeeIncentives && (
          <a
            href="#settings"
            className={activePage === 'settings' ? 'active' : ''}
            data-tooltip="Incentives"
            onClick={(e) => {
              e.preventDefault();
              handleNav('settings');
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="5" x2="5" y2="19"></line>
              <circle cx="6.5" cy="6.5" r="2.5"></circle>
              <circle cx="17.5" cy="17.5" r="2.5"></circle>
            </svg>
            <span>Incentives</span>
          </a>
        )}

        {canSeeUsers && (
          <a
            href="#users"
            className={activePage === 'users' ? 'active' : ''}
            data-tooltip="User Management"
            onClick={(e) => {
              e.preventDefault();
              handleNav('users');
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span>Users</span>
          </a>
        )}
      </nav>

      {/* Workspace status & shortcut helper card */}
      {!isCollapsedDesktop && (
        <div style={{ padding: '10px 12px', margin: '0 10px 10px 10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#e2e8f0' }}>CRM Workspace</span>
            <span style={{ fontSize: '0.68rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }}></span> Live
            </span>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
            {user.Role === 'admin' ? '🛡️ Admin Controls Active' : user.Role === 'manager' ? '📊 Team Manager Roster' : '💼 Agent Sales View'}
          </div>
          <div style={{ fontSize: '0.66rem', color: '#64748b', marginTop: '4px' }}>
            Shortcut: <kbd style={{ background: '#374151', padding: '1px 4px', borderRadius: '3px', color: '#e5e7eb' }}>Ctrl+B</kbd> toggles menu
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div
            className="avatar"
            title={isCollapsedDesktop ? `${user.Name} (${user.Role}) - Click to expand` : undefined}
            onClick={() => {
              if (isCollapsedDesktop) onToggleDesktopCollapse?.();
            }}
            style={{ cursor: isCollapsedDesktop ? 'pointer' : 'default' }}
          >
            {initials(user.Name)}
          </div>
          <div className="info">
            <div className="name" title={user.Name}>
              {user.Name}
            </div>
            <div className="role">{user.Role}</div>
          </div>
          <button
            type="button"
            className="change-password-btn"
            title="Change password"
            aria-label="Change password"
            onClick={() => {
              onChangePassword();
              onCloseMobile?.();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </button>
          <button id="logout-btn" type="button" title="Log out" aria-label="Log out" onClick={onLogout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>

        {isCollapsedDesktop && (
          <button
            type="button"
            className="collapsed-logout-btn"
            title="Log out"
            onClick={onLogout}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
};
