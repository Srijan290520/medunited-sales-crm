import React, { useState, useEffect } from 'react';
import { DeactivateUserModal } from './DeactivateUserModal';
import { UserRequestsPanel } from './UserRequestsPanel';
import { HandoverModal } from './HandoverModal';
import { User, UserRole } from '../types';
import { isTeamRole, isSeniorRole, isAdminRole, ROLE_LABELS } from '../utils/roles';
import { api } from '../services/api';
import { formatDate, initials, todayKey } from '../utils/date';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';

interface UsersViewProps {
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

export const UsersView: React.FC<UsersViewProps> = ({ user, onToast }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formRole, setFormRole] = useState<UserRole>('agent');
  const [formPassword, setFormPassword] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Admin Delete User Modal State
  const [deleteUserModal, setDeleteUserModal] = useState<User | null>(null);
  const [deleteUserReason, setDeleteUserReason] = useState<string>('');
  const [deleteUserError, setDeleteUserError] = useState<string | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState<boolean>(false);

  // Deactivation always names a successor (see DeactivateUserModal).
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [handoverFrom, setHandoverFrom] = useState<User | null>(null);
  const [requestsKey, setRequestsKey] = useState<number>(0);

  const openDeleteUserModal = (targetUser: User) => {
    if (user.Role !== 'admin') {
      onToast('Access denied: Only administrators can delete team accounts.', 'error');
      return;
    }
    if (targetUser.ID === user.ID) {
      onToast('You cannot delete your own account.', 'error');
      return;
    }
    setDeleteUserModal(targetUser);
    setDeleteUserReason('Employee left company');
    setDeleteUserError(null);
  };

  const closeDeleteUserModal = () => {
    setDeleteUserModal(null);
    setDeleteUserReason('');
    setDeleteUserError(null);
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteUserModal) return;
    const cleanReason = deleteUserReason.trim();
    if (!cleanReason) {
      setDeleteUserError('A reason is mandatory to delete this user.');
      return;
    }

    setIsDeletingUser(true);
    setDeleteUserError(null);
    try {
      const res = await api.deleteUser(deleteUserModal.ID, cleanReason);
      if (res.error) {
        setDeleteUserError(res.message || 'Could not delete user.');
      } else {
        onToast(`User ${deleteUserModal.Name} deleted. Reason logged.`, 'success');
        closeDeleteUserModal();
        loadUsers();
      }
    } catch (err: any) {
      setDeleteUserError(err.message || 'Error deleting user.');
    } finally {
      setIsDeletingUser(false);
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await api.listUsers();
      if (res.error) {
        onToast(res.message || 'Could not load users', 'error');
      } else {
        setUsers(res.users || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [user]);

  const openNewModal = () => {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormRole('agent');
    setFormPassword('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (u: User) => {
    setEditingUser(u);
    setFormName(u.Name);
    setFormEmail(u.Email);
    setFormRole(u.Role);
    setFormPassword('');
    setFormError(null);
    setModalOpen(true);
  };

  const handleToggleActive = async (u: User, newActive: boolean) => {
    if (!newActive) {
      setDeactivateTarget(u);
      return;
    }
    try {
      const res = await api.updateUser(u.ID, { active: newActive });
      if (res.error) {
        onToast(res.message || 'Could not update user status', 'error');
      } else {
        onToast(`User ${newActive ? 'activated' : 'deactivated'}`, 'success');
        loadUsers();
      }
    } catch (err: any) {
      onToast(err.message || 'Error updating user status', 'error');
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (!editingUser && !formEmail.trim()) {
      setFormError('Email is required.');
      return;
    }
    if (!editingUser && !formPassword.trim()) {
      setFormError('Password is required for new users.');
      return;
    }

    setSaving(true);
    try {
      if (editingUser) {
        const payload: any = {
          name: formName.trim(),
          role: formRole,
        };
        if (formPassword.trim()) {
          payload.password = formPassword.trim();
        }
        const res = await api.updateUser(editingUser.ID, payload);
        if (res.error) {
          setFormError(res.message || 'Could not update user.');
        } else {
          onToast('User updated successfully', 'success');
          setModalOpen(false);
          loadUsers();
        }
      } else {
        const res = await api.createUser({
          name: formName.trim(),
          email: formEmail.trim(),
          role: formRole,
          password: formPassword.trim(),
        });
        if (res.error) {
          setFormError(res.message || 'Could not create user.');
        } else {
          onToast('User created successfully', 'success');
          setModalOpen(false);
          loadUsers();
        }
      }
    } catch (err: any) {
      setFormError(err.message || 'Error saving user');
    } finally {
      setSaving(false);
    }
  };

  const canManageAll = isTeamRole(user.Role);

  const handleExportUsers = () => {
    if (!canManageAll) {
      onToast('Access denied: Export is only available for Managers and Admins.', 'error');
      return;
    }

    if (users.length === 0) {
      onToast('No users found to export.', 'error');
      return;
    }

    const columns: CsvColumn<User>[] = [
      { header: 'User ID', accessor: (u) => u.ID },
      { header: 'Full Name', accessor: (u) => u.Name },
      { header: 'Email Address', accessor: (u) => u.Email },
      { header: 'Role', accessor: (u) => u.Role },
      { header: 'Status', accessor: (u) => (u.Active ? 'Active' : 'Inactive') },
      { header: 'Added On', accessor: (u) => formatDate(u.CreatedAt) },
      { header: 'Created Timestamp', accessor: (u) => u.CreatedAt || '' },
    ];

    const timestamp = todayKey();
    exportToCsv(`MedUnited_Team_Members_${timestamp}.csv`, columns, users);
    onToast(`Exported ${users.length} team members to CSV`, 'success');
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Users</h1>
          <p className="subtitle">Manage agent, manager, and administrator logins and access</p>
        </div>
        <div className="topbar-actions">
          {canManageAll && (
            <button
              type="button"
              className="secondary"
              onClick={handleExportUsers}
              title="Export team members to CSV (Managers & Admins only)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 13px',
                fontWeight: 600,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Export CSV</span>
            </button>
          )}

          {isSeniorRole(user.Role) && (
            <button type="button" onClick={openNewModal}>
              + New User
            </button>
          )}
        </div>
      </div>

      <main>
        <UserRequestsPanel user={user} refreshKey={requestsKey} onToast={onToast} onChanged={loadUsers} />

        <div className="table-card">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '24%' }}>Team Member</th>
                  <th style={{ width: '26%' }}>Email Address</th>
                  <th style={{ width: '14%' }}>Role</th>
                  <th style={{ width: '14%' }}>Status</th>
                  <th style={{ width: '12%' }}>Added On</th>
                  <th style={{ width: '10%', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="loading-row">
                    <td colSpan={6} style={{ textAlign: 'center', padding: '36px' }}>Loading users…</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                      No team members found.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.ID}>
                      <td>
                        <div className="table-person">
                          <span className="avatar-sm">{initials(u.Name)}</span>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{u.Name}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>{u.Email}</span>
                      </td>
                      <td>
                        <span className={`role-badge ${u.Role}`}>{ROLE_LABELS[u.Role] || u.Role}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={!!u.Active}
                              disabled={u.ID === user.ID || (!isAdminRole(user.Role) && u.Role === 'admin') || (!isSeniorRole(user.Role) && !u.Active)}
                              title={isSeniorRole(user.Role) ? '' : 'Managers can ask an admin or senior manager to deactivate agents'}
                              onChange={(e) => handleToggleActive(u, e.target.checked)}
                            />
                            <span className="slider"></span>
                          </label>
                          <span style={{ fontSize: '0.78rem', color: u.Active ? '#16a34a' : '#94a3b8', fontWeight: 500 }}>
                            {u.Active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>{formatDate(u.CreatedAt)}</span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          {canManageAll && (u.Role === 'agent' || u.Role === 'manager') && (
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: '5px 12px', fontSize: '0.8rem', borderRadius: '6px' }}
                              onClick={() => setHandoverFrom(u)}
                              title="Move all of their patients and open records to someone else"
                            >
                              Hand over
                            </button>
                          )}
                          {isSeniorRole(user.Role) && (isAdminRole(user.Role) || u.Role !== 'admin') && (
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: '5px 12px', fontSize: '0.8rem', borderRadius: '6px' }}
                              onClick={() => openEditModal(u)}
                            >
                              Edit
                            </button>
                          )}
                          {user.Role === 'admin' && u.ID !== user.ID && (
                            <button
                              type="button"
                              className="danger"
                              style={{ padding: '5px 10px', fontSize: '0.8rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              onClick={() => openDeleteUserModal(u)}
                              title="Delete user account (Requires reason)"
                            >
                              <span>🗑️</span> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* New / Edit Modal */}
        {modalOpen && (
          <>
            <div className="overlay open" onClick={() => setModalOpen(false)} />
            <div className="sales-modal-popup open" style={{ maxWidth: '520px' }} role="dialog" aria-modal="true">
              <div className="modal-header-hero">
                <div className="modal-header-title">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h3>{editingUser ? 'Edit Team Member' : 'New Team Member'}</h3>
                      <span className="modal-header-badge">User Access</span>
                    </div>
                    <div className="modal-header-sub">
                      {editingUser ? `Editing profile for ${editingUser.Email}` : 'Invite a new agent, manager, or administrator to the CRM.'}
                    </div>
                  </div>
                </div>
                <button type="button" className="popup-close" onClick={() => setModalOpen(false)} title="Close">
                  &times;
                </button>
              </div>

              <form onSubmit={handleSaveUser} className="popup-body" style={{ padding: '24px 32px', background: '#ffffff' }}>
                {formError && <div className="form-error show" style={{ marginBottom: '16px' }}>{formError}</div>}

                <div className="form-section-block" style={{ margin: 0, padding: 0, border: 'none' }}>
                  <div style={{ marginBottom: '16px' }}>
                    <label>Full Name *</label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Rahul Sharma"
                      autoFocus
                    />
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label>Email Address *</label>
                    <input
                      type="email"
                      required
                      disabled={!!editingUser}
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="e.g. rahul@medunited.com"
                    />
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label>Role &amp; Permissions *</label>
                    <select value={formRole} onChange={(e) => setFormRole(e.target.value as UserRole)}>
                      <option value="agent">Agent (logs own sales &amp; leads)</option>
                      <option value="manager">Manager (views team sales &amp; assigns leads)</option>
                      <option value="senior_manager">Senior Manager (approvals, users, settings — no admin accounts or deletions)</option>
                      {isAdminRole(user.Role) && <option value="admin">Admin (full access, user management)</option>}
                    </select>
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <label>{editingUser ? 'New Password' : 'Temporary Password *'}</label>
                    <input
                      type="password"
                      required={!editingUser}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      autoComplete="new-password"
                      maxLength={128}
                      placeholder={editingUser ? 'Leave blank to keep current' : '10+ characters, letters and numbers'}
                    />
                    {editingUser && (
                      <small className="muted" style={{ display: 'block', marginTop: '4px', fontSize: '0.78rem' }}>
                        Leave blank if you do not wish to reset their password. A reset signs them out and they must choose a new one at next login.
                      </small>
                    )}
                  </div>
                </div>

                <div className="stepper-footer" style={{ margin: '0 -32px -24px -32px' }}>
                  <button type="button" className="secondary" onClick={() => setModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : editingUser ? 'Update User' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}

        {handoverFrom && (
          <HandoverModal
            from={handoverFrom}
            team={users}
            onClose={() => setHandoverFrom(null)}
            onDone={(msg) => {
              setHandoverFrom(null);
              onToast(msg, 'success');
            }}
          />
        )}

        {deactivateTarget && (
          <DeactivateUserModal
            user={user}
            target={deactivateTarget}
            team={users}
            onClose={() => setDeactivateTarget(null)}
            onDone={(msg) => {
              setDeactivateTarget(null);
              onToast(msg, 'success');
              setRequestsKey((k) => k + 1);
              loadUsers();
            }}
          />
        )}

        {/* Admin Delete User Confirmation Modal */}
        {deleteUserModal && (
          <>
            <div className="overlay open" style={{ zIndex: 1200 }} onClick={closeDeleteUserModal} />
            <div
              className="delete-confirmation-modal"
              role="dialog"
              aria-modal="true"
              style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: '#ffffff',
                borderRadius: '14px',
                width: '92%',
                maxWidth: '480px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
                zIndex: 1201,
                overflow: 'hidden',
                border: '1px solid #fecaca',
              }}
            >
              <div style={{ background: '#fef2f2', padding: '18px 24px', borderBottom: '1px solid #fee2e2', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', flexShrink: 0 }}>
                  ⚠️
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#991b1b', fontWeight: 700 }}>
                    Delete User Account
                  </h3>
                  <span style={{ fontSize: '0.78rem', color: '#b91c1c' }}>
                    Administrator Authorization · Reason Mandatory
                  </span>
                </div>
              </div>

              <div style={{ padding: '20px 24px' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <span className="avatar-sm">{initials(deleteUserModal.Name)}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#0f172a' }}>{deleteUserModal.Name}</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{deleteUserModal.Email} · Role: {deleteUserModal.Role}</div>
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Reason for account deletion <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <textarea
                    value={deleteUserReason}
                    onChange={(e) => {
                      setDeleteUserReason(e.target.value);
                      if (deleteUserError) setDeleteUserError(null);
                    }}
                    placeholder="Provide a reason for deleting this team member (e.g. Employee left company, Duplicate account, Role discontinued)..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: deleteUserError ? '1px solid #ef4444' : '1px solid #cbd5e1',
                      fontSize: '0.85rem',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      fontFamily: 'inherit',
                    }}
                    autoFocus
                  />
                  {deleteUserError && (
                    <div style={{ fontSize: '0.78rem', color: '#dc2626', marginTop: '4px', fontWeight: 500 }}>
                      {deleteUserError}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                    Quick suggestions:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {[
                      'Employee left company',
                      'Duplicate account',
                      'Role discontinued',
                      'Temporary contractor finished',
                    ].map((sugg) => (
                      <button
                        key={sugg}
                        type="button"
                        onClick={() => {
                          setDeleteUserReason(sugg);
                          if (deleteUserError) setDeleteUserError(null);
                        }}
                        style={{
                          background: deleteUserReason === sugg ? '#fee2e2' : '#f1f5f9',
                          color: deleteUserReason === sugg ? '#991b1b' : '#475569',
                          border: deleteUserReason === sugg ? '1px solid #fca5a5' : '1px solid #e2e8f0',
                          borderRadius: '6px',
                          padding: '4px 9px',
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                          fontWeight: deleteUserReason === sugg ? 600 : 400,
                        }}
                      >
                        + {sugg}
                      </button>
                    ))}
                  </div>
                </div>

                <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
                  ℹ️ This action is irreversible. The account credentials will be immediately revoked and purged from the active roster.
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={closeDeleteUserModal}
                  disabled={isDeletingUser}
                  style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={handleConfirmDeleteUser}
                  disabled={isDeletingUser || !deleteUserReason.trim()}
                  style={{
                    padding: '8px 18px',
                    fontSize: '0.85rem',
                    background: !deleteUserReason.trim() ? '#fca5a5' : '#dc2626',
                    cursor: !deleteUserReason.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isDeletingUser ? 'Deleting…' : 'Confirm & Delete User'}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};
