import React, { useState } from 'react';
import { User } from '../types';
import { isSeniorRole } from '../utils/roles';
import { SettingsView } from './SettingsView';
import { TargetsSection } from './TargetsSection';
import { MedpassSettingsCard } from './MedpassSettingsCard';
import { HomekareCatalogueCard } from './HomekareCatalogueCard';
import { PatientOwnersCard } from './PatientOwnersCard';
import { UsersView } from './UsersView';
import { AuditLogViewer } from './AuditLogViewer';

interface Props {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

type Section = 'rates' | 'targets' | 'lists' | 'catalogues' | 'owners' | 'users' | 'audit';

const SECTIONS: { id: Section; label: string; hint: string; seniorOnly?: boolean }[] = [
  { id: 'rates', label: 'Incentive rates', hint: 'Per agent: Medpass per sale, Pharmacy %' },
  { id: 'targets', label: 'Monthly targets', hint: 'Team target and targets per agent' },
  { id: 'lists', label: 'Dropdown lists', hint: 'Channels, heard from, lost reasons' },
  { id: 'catalogues', label: 'Service catalogues', hint: 'Medpass prices, Homekare services' },
  { id: 'owners', label: 'Patient owners', hint: 'Migration and owner decisions' },
  { id: 'users', label: 'Users', hint: 'Accounts, deactivation, handover' },
  { id: 'audit', label: 'Audit log', hint: 'Who changed what', seniorOnly: true },
];

const STORE_KEY = 'medunited_settings_section';

// Settings (managers and above): one page, a menu on the left. What each
// person may change inside a section is still decided by the server.
export const SettingsPage: React.FC<Props> = ({ user, onToast }) => {
  const visible = SECTIONS.filter((s) => !s.seniorOnly || isSeniorRole(user.Role));
  const [section, setSection] = useState<Section>(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY) as Section | null;
      if (saved && visible.some((s) => s.id === saved)) return saved;
    } catch {
      /* storage blocked: start at the top */
    }
    return 'rates';
  });
  const pick = (s: Section) => {
    setSection(s);
    try {
      localStorage.setItem(STORE_KEY, s);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div className="mp-header">
        <div className="mp-title">
          <h1>Settings</h1>
          <p className="subtitle">Rates, targets, lists, catalogues, people and the audit log</p>
        </div>
      </div>
      <main>
        <div className="st-layout">
          <nav className="st-menu" aria-label="Settings sections">
            {visible.map((s) => (
              <button key={s.id} type="button" className={`st-item${section === s.id ? ' active' : ''}`} aria-current={section === s.id ? 'page' : undefined} onClick={() => pick(s.id)}>
                <span>{s.label}</span>
                <small>{s.hint}</small>
              </button>
            ))}
          </nav>
          <div className="st-content">
            {section === 'rates' && <SettingsView user={user} onToast={onToast} section="rates" />}
            {section === 'targets' && (
              <>
                <SettingsView user={user} onToast={onToast} section="team-target" />
                <div style={{ height: '16px' }} />
                <TargetsSection user={user} onToast={onToast} />
              </>
            )}
            {section === 'lists' && <SettingsView user={user} onToast={onToast} section="lists" />}
            {section === 'catalogues' && (
              <>
                <MedpassSettingsCard user={user} onToast={onToast} />
                <HomekareCatalogueCard user={user} onToast={onToast} />
                <div className="card">
                  <div className="card-title">Lab &amp; Radiology</div>
                  <p className="muted small-text">Tests and packages are typed by hand on each record for now; a test list can be added later without changing records.</p>
                </div>
              </>
            )}
            {section === 'owners' && <PatientOwnersCard user={user} onToast={onToast} />}
            {section === 'users' && <UsersView user={user} onToast={onToast} />}
            {section === 'audit' && <AuditLogViewer onToast={onToast} />}
          </div>
        </div>
      </main>
    </div>
  );
};
