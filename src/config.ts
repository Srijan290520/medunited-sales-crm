// Where the backend lives. Read at runtime from config.js (served next to
// index.html), so the same build can be deployed to any host and pointed at
// any Apps Script deployment without rebuilding. A VITE_API_URL set at build
// time is used as the fallback.

declare global {
  interface Window {
    __CRM_CONFIG__?: { apiUrl?: string; appName?: string };
  }
}

const runtime = (typeof window !== 'undefined' && window.__CRM_CONFIG__) || {};

export const API_URL: string = (runtime.apiUrl || import.meta.env.VITE_API_URL || '').trim();

export const APP_NAME: string = runtime.appName || 'MedUnited CRM';

export const isApiConfigured = (): boolean =>
  import.meta.env.VITE_DEMO === 'true' || /^https:\/\/\S+$/.test(API_URL) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S*$/.test(API_URL);
