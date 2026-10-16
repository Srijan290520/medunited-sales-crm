import React from 'react';
import { ModuleInfo, SaleType } from './types';

// The sales modules. The server's list (getModules, from apps-script/Modules.gs)
// decides which exist; this file only holds how each one is worded and drawn.

// Used until the server's list arrives (and if it can't be loaded).
export const BUILT_IN_MODULES: ModuleInfo[] = [
  { id: 'medpass', label: 'Medpass', priceTypes: true, products: false, reminders: false, lineItems: false, incentive: 'perSale' },
  { id: 'pharmacy', label: 'Pharmacy', priceTypes: false, products: true, reminders: true, lineItems: false, incentive: 'percent' },
];

export interface ModuleText {
  title: string; // page heading
  badge: string; // record header badge
  step: string; // form step 2 name
  hint: string; // form step 2 hint
  next: string; // "Next: …" button
  detail: string; // column for the Detail summary
}

export const MODULE_TEXT: Record<SaleType, ModuleText> = {
  medpass: { title: 'Medpass Sales & Inquiries', badge: 'Medpass Subscription', step: '2. Medpass Plan', hint: 'Family members & pricing', next: 'Plan Details', detail: 'Plan Detail' },
  pharmacy: { title: 'Pharmacy Deliveries & Refills', badge: 'Pharmacy Pipeline', step: '2. Medicines & Dosing', hint: 'Dosages & refill cycles', next: 'Prescription', detail: 'Medicines' },
  homekare: { title: 'Homekare Services', badge: 'Home Care', step: '2. Services', hint: 'Services & prices', next: 'Services', detail: 'Services' },
  lab: { title: 'Lab & Radiology', badge: 'Diagnostics', step: '2. Tests', hint: 'Tests, collection & report', next: 'Tests', detail: 'Tests' },
};

export const isModulePage = (page: string): page is SaleType => page in MODULE_TEXT;

const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const MODULE_ICONS: Record<SaleType, React.ReactNode> = {
  medpass: svg(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>),
  pharmacy: svg(
    <>
      <rect x="1" y="7" width="15" height="11" rx="1.5"></rect>
      <path d="M16 10h3.5L22 13.5V18h-6"></path>
      <circle cx="6" cy="19.5" r="1.7"></circle>
      <circle cx="17.5" cy="19.5" r="1.7"></circle>
    </>
  ),
  homekare: svg(
    <>
      <path d="M3 10.5 12 3l9 7.5"></path>
      <path d="M5 9v12h14V9"></path>
      <path d="M12 12v6M9 15h6"></path>
    </>
  ),
  lab: svg(
    <>
      <path d="M9 3h6"></path>
      <path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"></path>
      <path d="M7.5 15h9"></path>
    </>
  ),
};
