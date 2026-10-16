import React from 'react';
import { User, ModuleInfo, SaleType } from '../types';
import { MODULE_ICONS } from '../modules';
import { isTeamRole } from '../utils/roles';
import { initials } from '../utils/date';

export type ActivePage = 'dashboard' | SaleType | 'reminders' | 'incentives' | 'settings' | 'users';

interface SidebarProps {
  user: User;
  modules: ModuleInfo[];
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
  modules,
  activePage,
  onNavigate,
  onLogout,
  onChangePassword,
  isOpenMobile,
  onCloseMobile,
  isCollapsedDesktop,
  onToggleDesktopCollapse,
}) => {
  const canSeeIncentives = isTeamRole(user.Role);
  // Managers see the team (read-only) so they can ask for deactivations.
  const canSeeUsers = isTeamRole(user.Role);

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

        {/* One link per sales module (the list comes from the server). */}
        {modules.map((m) => (
          <a
            key={m.id}
            href={`#${m.id}`}
            className={activePage === m.id ? 'active' : ''}
            data-tooltip={m.label}
            onClick={(e) => {
              e.preventDefault();
              handleNav(m.id);
            }}
          >
            {MODULE_ICONS[m.id] ?? MODULE_ICONS.medpass}
            <span>{m.label}</span>
          </a>
        ))}

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
            href="#incentives"
            className={activePage === 'incentives' ? 'active' : ''}
            data-tooltip="Incentives"
            onClick={(e) => {
              e.preventDefault();
              handleNav('incentives');
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

        {/* Settings holds rates, targets, lists, catalogues, users and the audit log. */}
        {canSeeUsers && (
          <a
            href="#settings"
            className={activePage === 'settings' || activePage === 'users' ? 'active' : ''}
            data-tooltip="Settings"
            onClick={(e) => {
              e.preventDefault();
              handleNav('settings');
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>
            </svg>
            <span>Settings</span>
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
            {user.Role === 'admin' ? '🛡️ Admin Controls Active' : user.Role === 'senior_manager' ? '🛡️ Senior Manager' : user.Role === 'manager' ? '📊 Team Manager Roster' : '💼 Agent Sales View'}
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
