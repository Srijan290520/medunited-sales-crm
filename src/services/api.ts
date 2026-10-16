// api.ts — the only place the app talks to the backend (Google Apps Script).
//
// Every call is a form-encoded POST: { action, token, payload: JSON }.
// Form encoding is a "simple" request, so the browser doesn't send a CORS
// preflight (Apps Script can't answer one).
//
// The session token lives in sessionStorage: it's gone when the tab or
// browser closes, which suits shared hospital computers. The server also
// expires it after 2 idle hours and 12 hours in total.

import { API_URL, isApiConfigured } from '../config';
import { User, UserRole, SaleType } from '../types';

export interface ApiResponse {
  error: boolean;
  message?: string;
  authError?: boolean;
  forbidden?: boolean;
  mustChangePassword?: boolean;
  [key: string]: any;
}

const TOKEN_KEY = 'medunited_crm_token';
const REQUEST_TIMEOUT_MS = 90_000; // Apps Script cold starts + screenshot uploads can be slow

export const AUTH_EXPIRED_EVENT = 'crm:auth-expired';
export const PASSWORD_CHANGE_EVENT = 'crm:password-change-required';

// Fallback when the browser blocks storage (private mode, sandboxed frames).
let memoryToken: string | null = null;

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

function writeToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the session just won't survive a reload */
  }
}

export const hasSession = (): boolean => !!readToken();

// The server sends { id, email, name, role, mustChangePassword }.
export function toUser(u: any): User {
  return {
    ID: String(u?.id ?? u?.ID ?? ''),
    Name: String(u?.name ?? u?.Name ?? ''),
    Email: String(u?.email ?? u?.Email ?? ''),
    Role: (u?.role ?? u?.Role ?? 'agent') as UserRole,
    MedpassFullRate: 0,
    MedpassDiscountRate: 0,
    PharmacyIncentivePercent: 0,
    Active: true,
    CreatedAt: '',
    MustChangePassword: !!(u?.mustChangePassword ?? u?.MustChangePassword),
  };
}

// Preview build (npm run build:demo): the real backend runs inside the page
// on sample data. Vite drops this branch from the production build.
const DEMO = import.meta.env.VITE_DEMO === 'true';

async function call(action: string, payload?: Record<string, unknown>): Promise<ApiResponse> {
  if (DEMO) {
    const { demoCall } = await import('../demo/demoBackend');
    return handleResult(await demoCall(action, readToken(), payload));
  }
  if (!isApiConfigured()) {
    return { error: true, message: 'The app is not connected to its server yet. Ask your admin to set apiUrl in config.js.' };
  }
  const body = new URLSearchParams();
  body.append('action', action);
  const token = readToken();
  if (token) body.append('token', token);
  if (payload) body.append('payload', JSON.stringify(payload));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      body,
      redirect: 'follow',
      credentials: 'omit', // never send Google cookies to the script
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
  } catch (err: any) {
    return {
      error: true,
      message:
        err?.name === 'AbortError'
          ? 'The server took too long to respond. Check your connection and try again.'
          : 'Could not reach the server. Check your internet connection and try again.',
    };
  } finally {
    clearTimeout(timer);
  }

  let data: ApiResponse;
  try {
    data = await res.json();
  } catch {
    return { error: true, message: 'The server sent an unexpected response. Please try again.' };
  }
  return handleResult(data);
}

function handleResult(data: ApiResponse): ApiResponse {
  if (!data || typeof data !== 'object') {
    return { error: true, message: 'The server sent an unexpected response. Please try again.' };
  }
  if (data.error) {
    if (data.authError) {
      writeToken(null);
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: data.message }));
    } else if (data.mustChangePassword) {
      window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_EVENT));
    }
  }
  return data;
}

export const api = {
  // ----- Session -----
  login: async (email: string, password: string): Promise<ApiResponse> => {
    const res = await call('login', { email, password });
    if (!res.error && res.token) {
      writeToken(res.token);
      return { ...res, token: undefined, user: toUser(res.user) };
    }
    return res;
  },

  logout: async (): Promise<ApiResponse> => {
    const res = readToken() ? await call('logout') : { error: false };
    writeToken(null);
    return res;
  },

  me: async (): Promise<ApiResponse> => {
    if (!readToken()) return { error: true, message: 'Not logged in' };
    const res = await call('me');
    return res.error ? res : { ...res, user: toUser(res.user) };
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<ApiResponse> => {
    const res = await call('changePassword', { currentPassword, newPassword });
    if (!res.error && res.token) {
      writeToken(res.token);
      return { ...res, token: undefined, user: toUser(res.user) };
    }
    return res;
  },

  // ----- Medpass & Pharmacy records -----
  listSales: (type: SaleType) => call('listSales', { type }),
  getSale: (type: SaleType, id: string) => call('getSale', { type, id }),
  createSale: (type: SaleType, data: any) => call('createSale', { type, data }),
  updateSale: (type: SaleType, id: string, data: any) => call('updateSale', { type, id, data }),
  deleteSale: (type: SaleType, id: string, reason?: string) => call('deleteSale', { type, id, reason }),
  logSaleActivity: (type: SaleType, id: string, data: any) => call('logSaleActivity', { type, id, data }),
  // Reassigns the record's patient: the whole household, or only this person.
  reassignSale: (type: SaleType, id: string, agentEmail: string, scope: 'household' | 'person' = 'household') =>
    call('reassignSale', { type, id, agentEmail, scope }),
  reopenSale: (type: SaleType, id: string, reason?: string) => call('reopenSale', { type, id, reason }),
  getAuditHistory: (type: SaleType, id: string) => call('getAuditHistory', { type, id }),
  checkContact: (contact: string, exceptId?: string) => call('checkContact', { contact, exceptId }),
  getAttachment: (type: SaleType, id: string, kind: 'bill' | 'payment') => call('getAttachment', { type, id, kind }),
  importSales: (
    type: SaleType,
    rows: Record<string, unknown>[],
    opts: { dryRun: boolean; agentEmail?: string; fileName?: string }
  ) => call('importSales', { type, rows, ...opts }),

  getModules: () => call('getModules'),

  // ----- Medpass (price, discounts) -----
  getMedpassSettings: () => call('getMedpassSettings'),
  updateMedpassSettings: (data: Record<string, unknown>) => call('updateMedpassSettings', { data }),
  listPendingDiscounts: () => call('listPendingDiscounts'),
  decideMedpassDiscount: (id: string, approve: boolean, note?: string) => call('decideMedpassDiscount', { id, approve, note }),

  // ----- Patients (owners, migration, conflicts) -----
  reassignPatient: (data: { contact?: string; patientId?: string; agentEmail: string; scope?: 'household' | 'person'; reason?: string }) =>
    call('reassignPatient', data),
  migratePatients: (dryRun: boolean) => call('migratePatients', { dryRun }),
  listPatientConflicts: () => call('listPatientConflicts'),
  resolvePatientConflict: (data: { contact: string; agentEmail?: string; assignments?: { patientId?: string; name?: string; agentEmail: string }[] }) =>
    call('resolvePatientConflict', data),

  // ----- Dashboard -----
  dashboardSummary: () => call('dashboardSummary'),

  // ----- Users & incentives -----
  listUsers: () => call('listUsers'),
  createUser: (data: { name: string; email: string; role: UserRole; password?: string }) => call('createUser', { data }),
  updateUser: (id: string, data: any) => call('updateUser', { id, data }),
  deleteUser: (id: string, reason?: string) => call('deleteUser', { id, reason }),
  updateIncentives: (id: string, data: any) => call('updateIncentives', { id, data }),
  // Deactivation always names who takes over the person's patients.
  requestDeactivation: (userId: string, successorEmail: string, reason: string) =>
    call('requestDeactivation', { userId, successorEmail, reason }),
  listUserRequests: (includeDecided = false) => call('listUserRequests', { includeDecided }),
  decideUserRequest: (id: string, approve: boolean, note?: string) => call('decideUserRequest', { id, approve, note }),

  // ----- Refill reminders -----
  listReminders: (includeResolved: boolean) => call('listReminders', { includeResolved }),
  markContacted: (id: string, outcome: 'not_interested' | 'could_not_connect') => call('markContacted', { id, outcome }),
  reassignReminder: (id: string, agentEmail: string) => call('reassignReminder', { id, agentEmail }),

  // ----- Settings -----
  getOptionLists: () => call('getLists'),
  updateOptionLists: (data: any) => call('updateLists', { data }),
  getMonthlyTarget: () => call('getMonthlyTarget'),
  updateMonthlyTarget: (amount: number) => call('updateMonthlyTarget', { amount }),
};
