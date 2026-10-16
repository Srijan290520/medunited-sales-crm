import { UserRole } from '../types';

// Mirrors the role groups in apps-script/Auth.gs. The server enforces them;
// these only decide what the screens show.

// See the whole team, reassign, incentives.
export const isTeamRole = (r: UserRole) => r === 'admin' || r === 'senior_manager' || r === 'manager';
// Approvals (discounts, deactivations), non-admin user accounts, lists, owner decisions.
export const isSeniorRole = (r: UserRole) => r === 'admin' || r === 'senior_manager';
// Admin accounts and hard deletes.
export const isAdminRole = (r: UserRole) => r === 'admin';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  senior_manager: 'Senior Manager',
  manager: 'Manager',
  agent: 'Agent',
};
