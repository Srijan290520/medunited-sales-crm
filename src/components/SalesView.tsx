import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import {
  User,
  Sale,
  SaleType,
  SaleStatus,
  PriceType,
  ProductLine,
  MedicineForm,
  LeadTemperature,
  LeadDirection,
  SaleActivity,
  ActivityType,
  ActivityOutcome,
  OptionLists,
  AuditEntry,
  ContactCheck,
  MedpassMember,
  MedpassSettings,
} from '../types';
import { api } from '../services/api';
import { isTeamRole, isSeniorRole } from '../utils/roles';
import { MedpassMembersEditor, MedpassQuoteBox, medpassQuote } from './MedpassFields';
import { PendingDiscountsPanel } from './PendingDiscountsPanel';
import { formatMoney, formatDate, formatDateTime, formatTimeAgo, initials, todayKey } from '../utils/date';
import { exportToCsv, CsvColumn } from '../utils/exportCsv';
import { readScreenshot } from '../utils/image';
import { ProofModal } from './ProofModal';
import { AttachmentImage, AttachmentRef } from './AttachmentImage';

interface SalesViewProps {
  type: SaleType;
  user: User;
  onToast: (msg: string, type?: 'error' | 'success') => void;
}

// Same comparison as the server's nameKey(): case, dots and extra spaces don't matter.
const normName = (v: string) => v.toLowerCase().replace(/[.,'"`_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const samePersonName = (a: string, b: string) => !!normName(b) && normName(a) === normName(b);

// The importer pulls in the Excel/CSV parsers, so it's only downloaded when opened.
const ImportModal = lazy(() => import('./ImportModal').then((m) => ({ default: m.ImportModal })));

export const SalesView: React.FC<SalesViewProps> = ({ type, user, onToast }) => {
  const isMedpass = type === 'medpass';
  const pageTitle = isMedpass ? 'Medpass Sales & Inquiries' : 'Pharmacy Deliveries & Refills';
  const canManageAll = isTeamRole(user.Role);

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'board' | 'table'>('board');
  const [activeTab, setActiveTab] = useState<'due' | 'pending' | 'completed' | 'cancelled' | 'all'>('due');

  // Filters
  const [search, setSearch] = useState<string>('');
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [tempFilter, setTempFilter] = useState<string>('');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [paymentFilter, setPaymentFilter] = useState<string>('');
  const [priceTypeFilter, setPriceTypeFilter] = useState<string>('');

  // Drag and Drop state
  const [draggedSaleId, setDraggedSaleId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<SaleStatus | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Dropdown option lists from server
  const [options, setOptions] = useState<OptionLists>({
    channels: ['Phone call', 'Walk-in', 'WhatsApp', 'Website form', 'Health camp', 'OPD/IPD referral', 'Other'],
    heardFrom: ['Google search', 'Facebook / Instagram', 'Newspaper', 'Doctor referral', 'Other'],
    lostReasons: ['Price too high', 'Already has a provider', 'Not reachable', 'Wrong number', 'Not interested', 'Other'],
    temperatures: ['Hot', 'Warm', 'Cold'],
    directions: ['Inbound', 'Outbound'],
    activityTypes: ['Call', 'WhatsApp', 'Visit', 'SMS', 'Email', 'Note'],
    activityDirections: ['Outgoing', 'Incoming'],
    outcomes: ['Connected', 'No answer', 'Call back later', 'Interested', 'Not interested', 'Wrong number'],
  });

  const [agentRoster, setAgentRoster] = useState<User[]>([]);
  const [importOpen, setImportOpen] = useState<boolean>(false);

  // Proof Modal
  const [proofModal, setProofModal] = useState<{ title: string; url: string; attachment?: AttachmentRef | null } | null>(null);

  // Modal / Drawer State
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [activities, setActivities] = useState<SaleActivity[]>([]);
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [historyTab, setHistoryTab] = useState<'audits' | 'activities' | 'all'>('audits');
  const [actStatusIntent, setActStatusIntent] = useState<'reopen' | 'complete' | 'keep'>('reopen');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Form Fields
  const [formCustomerName, setFormCustomerName] = useState<string>('');
  const [formContact, setFormContact] = useState<string>('');
  const [formDate, setFormDate] = useState<string>(todayKey());
  const [formDetail, setFormDetail] = useState<string>('');
  const [formAmount, setFormAmount] = useState<string>('');
  const [formStatus, setFormStatus] = useState<SaleStatus>('Pending');
  const [formPriceType, setFormPriceType] = useState<PriceType>('Full Price');
  // Medpass: who the pass covers, discount and OP fee (the server sets the price).
  const [formMembers, setFormMembers] = useState<MedpassMember[]>([]);
  const [formDiscount, setFormDiscount] = useState<string>('');
  const [formDiscountReason, setFormDiscountReason] = useState<string>('');
  const [formOpCredit, setFormOpCredit] = useState<string>('');
  const [medpassSettings, setMedpassSettings] = useState<MedpassSettings | null>(null);
  const [discountsKey, setDiscountsKey] = useState<number>(0);
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>('');
  const [formUtr, setFormUtr] = useState<string>('');
  const [formBillScreenshot, setFormBillScreenshot] = useState<string>('');
  const [formPaymentScreenshot, setFormPaymentScreenshot] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');

  // Integrated Lead attributes
  const [formTemperature, setFormTemperature] = useState<LeadTemperature>('Warm');
  const [formDirection, setFormDirection] = useState<LeadDirection>('Inbound');
  const [formChannel, setFormChannel] = useState<string>('Phone call');
  const [formHeardFrom, setFormHeardFrom] = useState<string>('');
  const [formConsent, setFormConsent] = useState<boolean>(true);
  const [formDoNotCall, setFormDoNotCall] = useState<boolean>(false);
  const [formLostReason, setFormLostReason] = useState<string>('');
  const [formNextFollowUp, setFormNextFollowUp] = useState<string>('');
  const [formAgentEmail, setFormAgentEmail] = useState<string>(user.Email);

  // Pharmacy Products
  const [formProducts, setFormProducts] = useState<ProductLine[]>([
    { name: '', quantity: 30, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet', unitName: 'tabs' },
  ]);

  // Duplicate phone warning
  const [contactInfo, setContactInfo] = useState<ContactCheck | null>(null);
  const [personChoice, setPersonChoice] = useState<string>(''); // '' = someone new on this number
  const [formPatientId, setFormPatientId] = useState<string>('');
  const [reassignScope, setReassignScope] = useState<'household' | 'person'>('household');

  // Activity Log inputs
  const [actType, setActType] = useState<ActivityType>('Call');
  const [actDirection, setActDirection] = useState<'Outgoing' | 'Incoming'>('Outgoing');
  const [actOutcome, setActOutcome] = useState<ActivityOutcome>('Connected');
  const [actNotes, setActNotes] = useState<string>('');
  const [actNextFollowUp, setActNextFollowUp] = useState<string>('');

  // Structured multi-step & tab flow state
  const [activeStep, setActiveStep] = useState<number>(1);
  const [editMainTab, setEditMainTab] = useState<'details' | 'log_contact' | 'history'>('details');

  const setQuickFollowUp = (daysAhead: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    setFormNextFollowUp(`${yyyy}-${mm}-${dd}`);
  };

  const getRefillDays = (product: ProductLine): number | null => {
    if (product.customDays && product.customDays > 0) {
      return Math.round(product.customDays);
    }
    const freqDoses = product.frequency === 'Thrice a day' ? 3 : product.frequency === 'Twice a day' ? 2 : 1;
    if (product.formType === 'syrup') {
      const vol = (product.bottleVolume || product.quantity || 100) * (product.bottlesCount || 1);
      const dose = product.unitsPerDose || 5;
      const dailyMl = dose * freqDoses;
      return dailyMl > 0 ? Math.floor(vol / dailyMl) : null;
    }
    if (product.formType === 'inhaler') {
      const totalPuffs = product.quantity || 200;
      const dose = product.unitsPerDose || 2;
      const dailyPuffs = dose * freqDoses;
      return dailyPuffs > 0 ? Math.floor(totalPuffs / dailyPuffs) : null;
    }
    if (product.formType === 'cream' || product.formType === 'drops') {
      return product.customDays || ((product.quantity || 1) * 15);
    }
    if (product.formType === 'injection') {
      const totalUnits = product.quantity || 300;
      const dose = product.unitsPerDose || 20;
      return dose > 0 ? Math.floor(totalUnits / dose) : null;
    }
    if (product.formType === 'course') {
      return product.customDays || product.quantity || 7;
    }
    const pillsPerDay = (Number(product.unitsPerDose) || 1) * freqDoses;
    if (!pillsPerDay || !product.quantity) return null;
    return Math.floor(product.quantity / pillsPerDay);
  };

  const handleNextStep = () => {
    setFormError(null);
    if (activeStep === 1) {
      if (!formCustomerName.trim()) {
        setFormError('Customer Name is required to proceed.');
        return;
      }
      if (contactWarning?.blocking && !editingSale) {
        setFormError(contactWarning?.message || 'This person already has an open record in this module.');
        return;
      }
      setActiveStep(2);
    } else if (activeStep === 2) {
      const amt = Number(formAmount);
      if (formAmount !== '' && (isNaN(amt) || amt < 0)) {
        setFormError('Amount must be a non-negative number.');
        return;
      }
      if (!isMedpass) {
        // Blank lines are fine for an enquiry; named lines need a quantity.
        const valid = formProducts.filter((p) => p.name.trim()).every((p) => p.quantity > 0);
        if (!valid) {
          setFormError('Please enter a valid quantity for every medicine.');
          return;
        }
      }
      setActiveStep(3);
    }
  };

  const handlePrevStep = () => {
    setFormError(null);
    if (activeStep > 1) {
      setActiveStep(activeStep - 1);
    }
  };


  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.listSales(type);
      if (res.error) {
        onToast(res.message || 'Could not load sales', 'error');
      } else {
        setSales(res.sales || []);
      }

      const optRes = await api.getOptionLists();
      if (!optRes.error && optRes.lists) setOptions(optRes.lists);
      if (isMedpass) {
        const mpRes = await api.getMedpassSettings();
        if (!mpRes.error) setMedpassSettings(mpRes.settings);
        setDiscountsKey((k) => k + 1);
      }

      if (canManageAll) {
        const uRes = await api.listUsers();
        if (!uRes.error && uRes.users) {
          setAgentRoster(uRes.users.filter((u: User) => (u.Role === 'agent' || u.Role === 'manager') && u.Active));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [type, user]);

  // Who handles this number, and who is already on it (checked as the phone
  // number is typed). The server makes the final decision on save.
  useEffect(() => {
    setPersonChoice('');
    setFormPatientId('');
    const digits = formContact.replace(/\D/g, '');
    if (digits.length < 6) {
      setContactInfo(null);
      return;
    }

    const timer = setTimeout(async () => {
      const res = await api.checkContact(formContact, editingSale?.ID);
      setContactInfo(res.error ? null : (res as unknown as ContactCheck));
    }, 400);

    return () => clearTimeout(timer);
  }, [formContact, editingSale]);

  const moduleLabel = isMedpass ? 'Medpass' : 'Pharmacy';
  const matchedPerson = contactInfo?.people.find((p) => samePersonName(p.Name, formCustomerName)) || null;

  // The agent a new record will go to, if the number already has one.
  const lockedOwner: { name: string } | null = (() => {
    if (!contactInfo || contactInfo.conflict || editingSale) return null;
    if (matchedPerson?.OwnerName) return { name: matchedPerson.OwnerName };
    if (contactInfo.owner) return { name: contactInfo.owner.name };
    return null;
  })();

  const contactWarning = useMemo((): { message: string; blocking: boolean } | null => {
    if (!contactInfo) return null;
    const parts: string[] = [];
    let blocking = false;
    if (!editingSale && matchedPerson && matchedPerson.OpenModules.includes(moduleLabel)) {
      blocking = true;
      parts.push(`${matchedPerson.Name} already has an open ${moduleLabel} record. Open that record instead.`);
    }
    if (contactInfo.conflict) {
      parts.push('An admin still has to decide who handles this number; the record will be saved as entered.');
    } else if (contactInfo.owner && !contactInfo.owner.isMe) {
      parts.push(`This number is handled by ${contactInfo.owner.name}. ${editingSale ? '' : 'New records for it go to them.'}`.trim());
    } else if (!contactInfo.owner && contactInfo.owners.length > 1) {
      parts.push(`People on this number are handled by ${contactInfo.owners.map((o) => o.name).join(' and ')}.`);
    }
    if (contactInfo.pastCompletedCount > 0) {
      parts.push(`Existing customer: ${contactInfo.pastCompletedCount} completed purchase(s) on this number.`);
    }
    return parts.length ? { message: parts.join(' '), blocking } : null;
  }, [contactInfo, matchedPerson, editingSale, moduleLabel]);


  const openNewModal = () => {
    setEditingSale(null);
    setActivities([]);
    setAuditHistory([]);
    setHistoryTab('audits');
    setFormCustomerName('');
    setFormContact('');
    setFormDate(todayKey());
    setFormDetail('');
    setFormMembers([]);
    setFormDiscount('');
    setFormDiscountReason('');
    setFormOpCredit('');
    setFormAmount('');
    setFormStatus('Pending');
    setFormPriceType('Full Price');
    setFormPaymentMethod('');
    setFormUtr('');
    setFormBillScreenshot('');
    setFormPaymentScreenshot('');
    setFormNotes('');
    setFormTemperature('Warm');
    setFormDirection('Inbound');
    setFormChannel(options.channels[0] || 'Phone call');
    setFormHeardFrom('');
    setFormConsent(true);
    setFormDoNotCall(false);
    setFormLostReason('');
    setFormNextFollowUp(todayKey());
    setFormAgentEmail(user.Email);
    setFormProducts([{ name: '', quantity: 30, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet', unitName: 'tabs' }]);
    setContactInfo(null);
    setPersonChoice('');
    setFormPatientId('');
    setFormError(null);
    setActiveStep(1);
    setEditMainTab('details');
    setModalOpen(true);
  };

  const openEditModal = async (sale: Sale, initialStep: number = 1) => {
    setFormError(null);
    setActiveStep(initialStep);
    setEditMainTab('details');
    setEditingSale(sale);
    setFormCustomerName(sale.CustomerName);
    setFormContact(sale.Contact);
    setFormDate(sale.Date || todayKey());
    setFormDetail(sale.Detail || '');
    setFormMembers((sale.Members || []).map((m) => ({ ...m })));
    setFormDiscount(sale.DiscountAmount ? String(sale.DiscountAmount) : '');
    setFormDiscountReason(sale.DiscountReason || '');
    setFormOpCredit(sale.OPCredit ? String(sale.OPCredit) : '');
    setFormAmount(String(sale.Amount || ''));
    setFormStatus(sale.Status);
    setFormPriceType((sale.PriceType as PriceType) || 'Full Price');
    setFormPaymentMethod(sale.PaymentMethod || '');
    setFormUtr(sale.UTR || '');
    setFormBillScreenshot(sale.BillScreenshotUrl || '');
    setFormPaymentScreenshot(sale.PaymentScreenshotUrl || '');
    setFormNotes(sale.Notes || '');
    setFormTemperature(sale.Temperature || 'Warm');
    setFormDirection(sale.Direction || 'Inbound');
    setFormChannel(sale.Channel || options.channels[0] || 'Phone call');
    setFormHeardFrom(sale.HeardFrom || '');
    setFormConsent(sale.Consent !== undefined ? sale.Consent : true);
    setFormDoNotCall(!!sale.DoNotCall);
    setFormLostReason(sale.LostReason || '');
    setFormNextFollowUp(sale.NextFollowUp || '');
    setFormAgentEmail(sale.AgentEmail);
    setReassignScope('household');

    if (!isMedpass) {
      try {
        const parsed = JSON.parse(sale.Products || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) {
          setFormProducts(
            parsed.map((p) => ({
              ...p,
              formType: p.formType || 'tablet',
              unitName: p.unitName || (p.formType === 'syrup' ? 'ml' : p.formType === 'inhaler' ? 'puffs' : 'tabs'),
            }))
          );
        } else {
          setFormProducts([{ name: '', quantity: 30, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet', unitName: 'tabs' }]);
        }
      } catch {
        setFormProducts([{ name: '', quantity: 30, frequency: 'Once a day', unitsPerDose: 1, formType: 'tablet', unitName: 'tabs' }]);
      }
    }

    // Reset activity logger
    setActType('Call');
    setActDirection(sale.DoNotCall ? 'Incoming' : 'Outgoing');
    setActOutcome('Connected');
    setActNotes('');
    setActNextFollowUp('');
    setActStatusIntent(sale.Status === 'Cancelled' ? 'reopen' : 'keep');
    setHistoryTab('audits');

    // Fetch activities and audit history
    const detailRes = await api.getSale(type, sale.ID);
    if (!detailRes.error) {
      if (detailRes.activities) setActivities(detailRes.activities);
      if (detailRes.auditHistory) setAuditHistory(detailRes.auditHistory);
    } else {
      setActivities([]);
      setAuditHistory([]);
    }

    setModalOpen(true);
  };

  const openEditMedicationsModal = (sale: Sale) => {
    openEditModal(sale, 2);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'bill' | 'payment') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readScreenshot(file);
      if (target === 'bill') setFormBillScreenshot(dataUrl);
      else setFormPaymentScreenshot(dataUrl);
    } catch (err: any) {
      onToast(err.message || 'Could not use that image.', 'error');
    }
  };

  const handleSaveSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formCustomerName.trim()) {
      setFormError('Customer name is required.');
      return;
    }

    if (contactWarning?.blocking && !editingSale) {
      setFormError(contactWarning?.message || 'This person already has an open record in this module.');
      return;
    }

    const amt = Number(formAmount);
    if (formAmount !== '' && (isNaN(amt) || amt < 0)) {
      setFormError('Amount must be a non-negative number.');
      return;
    }

    const namedProducts = formProducts.filter((p) => p.name.trim());
    if (!isMedpass) {
      if (!namedProducts.every((p) => p.quantity > 0)) {
        setFormError('Please enter a valid quantity for every medicine.');
        return;
      }
      if (formStatus === 'Completed' && namedProducts.length === 0) {
        setFormError('Add the medicines before marking this Pharmacy sale as Completed.');
        return;
      }
    }

    if (formStatus === 'Cancelled' && !formLostReason) {
      setFormError('Please select a cancellation / lost reason.');
      return;
    }

    // Completion requirements
    if (formStatus === 'Completed') {
      if (!formPaymentMethod) {
        setFormError('Payment method is required to mark this sale as Completed.');
        return;
      }
      if (!formBillScreenshot) {
        setFormError('A bill screenshot is required to mark this sale as Completed.');
        return;
      }
      if (!formPaymentScreenshot) {
        setFormError('A payment screenshot is required to mark this sale as Completed.');
        return;
      }
      if (formPaymentMethod === 'UPI' && !formUtr.trim()) {
        setFormError('UTR number is required for UPI payments.');
        return;
      }
    }

    const payload: any = {
      customerName: formCustomerName.trim(),
      contact: formContact.trim(),
      date: formDate,
      amount: amt || 0,
      status: formStatus,
      paymentMethod: formPaymentMethod,
      utr: formUtr.trim(),
      billScreenshot: formBillScreenshot,
      paymentScreenshot: formPaymentScreenshot,
      notes: formNotes.trim(),
      temperature: formTemperature,
      direction: formDirection,
      channel: formChannel,
      heardFrom: formDirection === 'Inbound' ? formHeardFrom : '',
      consent: formConsent,
      doNotCall: formDoNotCall,
      lostReason: formLostReason,
      nextFollowUp: formNextFollowUp,
      agentEmail: formAgentEmail,
      ...(editingSale ? {} : { patientId: formPatientId }),
    };

    if (isMedpass) {
      payload.detail = formDetail.trim();
      payload.priceType = formPriceType;
      payload.members = formMembers.map((m) => ({ name: m.name.trim(), relation: m.relation, dob: m.dob }));
      if (formPriceType === 'Discounted') {
        payload.discountAmount = formDiscount === '' ? '' : Number(formDiscount);
        payload.discountReason = formDiscountReason.trim();
      }
      if (formPriceType === 'Converted From OP') payload.opCredit = formOpCredit === '' ? '' : Number(formOpCredit);
    } else {
      payload.products = namedProducts;
    }

    setSaving(true);
    try {
      let res;
      if (editingSale) {
        res = await api.updateSale(type, editingSale.ID, payload);
      } else {
        res = await api.createSale(type, payload);
      }

      if (res.error) {
        setFormError(res.message || 'Could not save entry.');
      } else {
        // e.g. "Already handled by Arjun — assigned to them."
        onToast(res.notice || (editingSale ? 'Saved successfully' : 'Created successfully'), 'success');
        setModalOpen(false);
        loadData();
      }
    } catch (err: any) {
      setFormError(err.message || 'Error occurred saving');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMedicationsOnly = async () => {
    if (!editingSale) return;
    setFormError(null);

    const valid = formProducts.every((p) => p.name.trim() && p.quantity > 0);
    if (!valid) {
      setFormError('Please enter a medicine name and valid quantity for all product lines.');
      return;
    }

    setSaving(true);
    try {
      const res = await api.updateSale(type, editingSale.ID, {
        products: formProducts,
        notes: formNotes.trim(),
      });

      if (res.error) {
        setFormError(res.message || 'Could not update prescribed medications.');
      } else {
        onToast('Prescribed medications updated successfully!', 'success');
        setModalOpen(false);
        loadData();
      }
    } catch (err: any) {
      setFormError(err.message || 'Error updating medications');
    } finally {
      setSaving(false);
    }
  };

  const handleLogActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSale) return;

    if (actType === 'Note' && !actNotes.trim()) {
      onToast('Please enter text for the note', 'error');
      return;
    }

    const statusUpdate =
      actStatusIntent === 'reopen'
        ? 'reopen_pending'
        : actStatusIntent === 'complete'
        ? 'complete_sale'
        : undefined;

    try {
      const res = await api.logSaleActivity(type, editingSale.ID, {
        type: actType,
        direction: actType === 'Note' ? '' : actDirection,
        outcome: actType === 'Note' ? '' : actOutcome,
        notes: actNotes.trim(),
        nextFollowUp: actNextFollowUp,
        statusUpdate,
      });

      if (res.error) {
        onToast(res.message || 'Could not log activity', 'error');
      } else {
        if (editingSale.Status === 'Cancelled' && res.sale.Status === 'Pending') {
          onToast('Lead reopened! Status is now Pending with Hot priority.', 'success');
        } else {
          onToast(actType === 'Note' ? 'Note added' : 'Contact interaction logged', 'success');
        }

        setEditingSale(res.sale);
        setFormStatus(res.sale.Status);
        setFormTemperature(res.sale.Temperature || 'Hot');
        setFormLostReason(res.sale.LostReason || '');
        setActivities(res.activities || []);
        if (res.auditHistory) setAuditHistory(res.auditHistory);
        setActNotes('');
        setActNextFollowUp('');

        if (actStatusIntent === 'complete' && res.sale.Status !== 'Completed') {
          setFormStatus('Completed');
          onToast('Customer wants to buy! Please fill in payment details & receipt to finalize.', 'success');
        }

        loadData();
      }
    } catch (err: any) {
      onToast(err.message || 'Error logging activity', 'error');
    }
  };

  const handleReopenLead = async (sale: Sale) => {
    try {
      const res = await api.reopenSale(
        type,
        sale.ID,
        'Customer contacted back and expressed interest in service. Lead reopened to Pending with Hot priority.'
      );
      if (res.error) {
        onToast(res.message || 'Could not reopen lead', 'error');
      } else {
        onToast('Lead reopened! Status is now Pending with Hot priority.', 'success');
        setEditingSale(res.sale);
        setFormStatus('Pending');
        setFormTemperature('Hot');
        setFormLostReason('');
        const detailRes = await api.getSale(type, sale.ID);
        if (!detailRes.error) {
          if (detailRes.activities) setActivities(detailRes.activities);
          if (detailRes.auditHistory) setAuditHistory(detailRes.auditHistory);
        }
        loadData();
      }
    } catch (err: any) {
      onToast(err.message || 'Error reopening lead', 'error');
    }
  };

  const handleQuickReopen = async (sale: Sale) => {
    try {
      const res = await api.reopenSale(type, sale.ID);
      if (res.error) {
        onToast(res.message || 'Could not reopen lead', 'error');
      } else {
        onToast(`Reopened ${sale.CustomerName} as active Hot lead!`, 'success');
        loadData();
      }
    } catch (err: any) {
      onToast(err.message || 'Error reopening lead', 'error');
    }
  };

  const handleQuickComplete = (sale: Sale) => {
    openEditModal(sale);
    setFormStatus('Completed');
    onToast('Enter payment details and screenshots to complete sale.', 'success');
  };

  const handleQuickCancel = (sale: Sale) => {
    openEditModal(sale);
    setFormStatus('Cancelled');
    onToast('Please specify the cancellation / lost reason.', 'error');
  };

  const handleReassignSale = async (targetEmail: string) => {
    if (!editingSale || !targetEmail) return;
    try {
      const scope = (editingSale.HouseholdSize || 1) > 1 ? reassignScope : 'household';
      const res = await api.reassignSale(type, editingSale.ID, targetEmail, scope);
      if (res.error) {
        onToast(res.message || 'Could not reassign entry', 'error');
      } else {
        const n = (res.moved || []).length;
        onToast(`Assigned to ${res.sale.AgentName}` + (n > 1 ? ` — ${n} open records moved` : ''), 'success');
        setEditingSale(res.sale);
        setFormAgentEmail(res.sale.AgentEmail);
        const detailRes = await api.getSale(type, res.sale.ID);
        if (!detailRes.error && detailRes.auditHistory) {
          setAuditHistory(detailRes.auditHistory);
        }
        loadData();
      }
    } catch (err: any) {
      onToast(err.message || 'Error reassigning', 'error');
    }
  };

  // Admin-only Delete with required reason
  const [deleteModalSale, setDeleteModalSale] = useState<Sale | null>(null);
  const [deleteReason, setDeleteReason] = useState<string>('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const openDeleteModal = (sale: Sale) => {
    if (user.Role !== 'admin') {
      onToast('Access restricted: Only administrators have permission to delete records.', 'error');
      return;
    }
    setDeleteModalSale(sale);
    setDeleteReason('Duplicate entry in CRM');
    setDeleteError(null);
  };

  const closeDeleteModal = () => {
    setDeleteModalSale(null);
    setDeleteReason('');
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalSale) return;
    const trimmed = deleteReason.trim();
    if (!trimmed) {
      setDeleteError('A reason is mandatory to delete this record.');
      return;
    }
    if (trimmed.length < 3) {
      setDeleteError('Please provide a more descriptive reason (min 3 characters).');
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await api.deleteSale(type, deleteModalSale.ID, trimmed);
      if (res.error) {
        setDeleteError(res.message || 'Could not delete record');
      } else {
        onToast(`Record for ${deleteModalSale.CustomerName} deleted. Reason logged in audit trail.`, 'success');
        closeDeleteModal();
        if (modalOpen && editingSale?.ID === deleteModalSale.ID) {
          setModalOpen(false);
          setEditingSale(null);
        }
        loadData();
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Error deleting record');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCardDrop = async (saleId: string, targetStatus: SaleStatus) => {
    const sale = sales.find((s) => s.ID === saleId);
    if (!sale || sale.Status === targetStatus) return;

    if (user.Role === 'agent' && sale.Status === 'Completed') {
      onToast('Completed sales are locked for agents. Ask a manager to modify.', 'error');
      return;
    }

    if (targetStatus === 'Completed') {
      const hasProof =
        sale.PaymentMethod &&
        sale.BillScreenshotUrl &&
        sale.PaymentScreenshotUrl &&
        (sale.PaymentMethod !== 'UPI' || sale.UTR);

      if (!hasProof) {
        onToast('To mark Completed, please attach payment method and proof screenshots.', 'error');
        await openEditModal(sale);
        setFormStatus('Completed');
        return;
      }
    }

    if (targetStatus === 'Cancelled' && !sale.LostReason) {
      await openEditModal(sale);
      setFormStatus('Cancelled');
      onToast('Please specify the cancellation / lost reason.', 'error');
      return;
    }

    try {
      let res;
      if (sale.Status === 'Cancelled' && targetStatus === 'Pending') {
        // Dragged from Cancelled back to Pending -> Reopen with Hot priority!
        res = await api.reopenSale(type, sale.ID, 'Customer recontacted / moved from Cancelled to Pending on board.');
      } else {
        res = await api.updateSale(type, sale.ID, { status: targetStatus });
      }

      if (res.error) {
        onToast(res.message || 'Could not update status', 'error');
      } else {
        onToast(
          targetStatus === 'Pending' && sale.Status === 'Cancelled'
            ? 'Lead reopened to Pending (Marked Hot)!'
            : `Moved to ${targetStatus === 'Cancelled' ? 'Cancelled / Lost' : targetStatus}`,
          'success'
        );
        loadData();
      }
    } catch (err: any) {
      onToast(err.message || 'Error updating status', 'error');
    }
  };

  const isCompletedLockedForAgent = (sale: Sale) => {
    return user.Role === 'agent' && sale.Status === 'Completed';
  };

  // Financial amounts and payment proofs are locked for agents on completed sales
  const isFinancialLocked = Boolean(editingSale && isCompletedLockedForAgent(editingSale));
  // Prescribed medications and dosing are NEVER locked - agents and managers can always adjust dosages & refills
  const isLocked = false;

  // Medpass price preview; records from before the price rules keep their amount once completed.
  const medpassLegacyAmount = editingSale && editingSale.Status === 'Completed' && (editingSale.ListPrice === null || editingSale.ListPrice === undefined) ? editingSale.Amount : null;
  const quote = isMedpass && medpassSettings ? medpassQuote(medpassSettings, formMembers, formPriceType, formDiscount, formOpCredit) : null;

  const decideDiscount = async (approve: boolean) => {
    if (!editingSale) return;
    let note = '';
    if (!approve) {
      note = (window.prompt('Why is this discount rejected?') || '').trim();
      if (note.length < 3) return;
    }
    const res = await api.decideMedpassDiscount(editingSale.ID, approve, note);
    if (res.error) return onToast(res.message || 'Could not save the decision.', 'error');
    onToast(approve ? 'Discount approved.' : 'Discount rejected.', 'success');
    setEditingSale(res.sale);
    loadData();
  };

  // Tab filtering
  const inTab = (s: Sale, tab: string) => {
    if (tab === 'due') {
      return (
        s.Status === 'Pending' &&
        (s.FollowUpStatus === 'overdue' || s.FollowUpStatus === 'today' || !s.NextFollowUp)
      );
    }
    if (tab === 'pending') return s.Status === 'Pending';
    if (tab === 'completed') return s.Status === 'Completed';
    if (tab === 'cancelled') return s.Status === 'Cancelled';
    return true;
  };

  // Filtered sales
  const filteredSales = sales.filter((s) => {
    if (!inTab(s, activeTab)) return false;
    if (agentFilter && s.AgentEmail.toLowerCase() !== agentFilter.toLowerCase()) return false;
    if (tempFilter && s.Temperature !== tempFilter) return false;
    if (channelFilter && s.Channel !== channelFilter) return false;
    if (paymentFilter && s.PaymentMethod !== paymentFilter) return false;
    if (isMedpass && priceTypeFilter && s.PriceType !== priceTypeFilter) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      const nameHit = s.CustomerName.toLowerCase().includes(q);
      const phoneHit = qDigits.length >= 3 && s.Contact.replace(/\D/g, '').includes(qDigits);
      const detailHit = s.Detail.toLowerCase().includes(q);
      const agentHit = s.AgentName.toLowerCase().includes(q);
      if (!nameHit && !phoneHit && !detailHit && !agentHit) return false;
    }
    return true;
  });

  const tabCounts = {
    due: sales.filter((s) => inTab(s, 'due')).length,
    pending: sales.filter((s) => inTab(s, 'pending')).length,
    completed: sales.filter((s) => inTab(s, 'completed')).length,
    cancelled: sales.filter((s) => inTab(s, 'cancelled')).length,
    all: sales.length,
  };

  const agentOptions = Array.from(
    new Set(sales.map((s) => JSON.stringify({ email: s.AgentEmail, name: s.AgentName })))
  ).map((str) => JSON.parse(str));

  const handleExportSales = () => {
    if (!canManageAll) {
      onToast('Access denied: Export is only available for Managers and Admins.', 'error');
      return;
    }

    const exportData = filteredSales;
    if (exportData.length === 0) {
      onToast('No sales records match the current filters to export.', 'error');
      return;
    }

    const columns: CsvColumn<Sale>[] = [
      { header: 'Record ID', accessor: (s) => s.ID },
      { header: 'Date', accessor: (s) => s.Date || '' },
      { header: 'Customer Name', accessor: (s) => s.CustomerName },
      { header: 'Contact Number', accessor: (s) => s.Contact },
      { header: 'Status', accessor: (s) => s.Status },
      { header: 'Lead Temperature', accessor: (s) => s.Temperature || 'Warm' },
      { header: 'Lead Direction', accessor: (s) => s.Direction || 'Inbound' },
      { header: 'Lead Channel', accessor: (s) => s.Channel || '' },
      { header: 'Heard From', accessor: (s) => s.HeardFrom || '' },
      { header: isMedpass ? 'Plan Detail' : 'Prescribed Medicines', accessor: (s) => s.Detail || '' },
      { header: 'Amount (INR)', accessor: (s) => s.Amount || 0 },
      { header: 'Price Type', accessor: (s) => s.PriceType || '' },
      { header: 'Payment Method', accessor: (s) => s.PaymentMethod || '' },
      { header: 'UTR Number', accessor: (s) => s.UTR || '' },
      { header: 'Bill Screenshot Attached', accessor: (s) => s.BillScreenshotUrl ? 'Yes' : 'No' },
      { header: 'Payment Screenshot Attached', accessor: (s) => s.PaymentScreenshotUrl ? 'Yes' : 'No' },
      { header: 'Next Follow-up Date', accessor: (s) => s.NextFollowUp || '' },
      { header: 'Follow-up Status', accessor: (s) => s.FollowUpStatus || '' },
      { header: 'Contact Attempts', accessor: (s) => s.AttemptCount ?? 0 },
      { header: 'Assigned Agent Name', accessor: (s) => s.AgentName },
      { header: 'Assigned Agent Email', accessor: (s) => s.AgentEmail },
      { header: 'Do Not Call (DND)', accessor: (s) => s.DoNotCall ? 'Yes' : 'No' },
      { header: 'Lost / Cancellation Reason', accessor: (s) => s.LostReason || '' },
      { header: 'Customer Notes', accessor: (s) => s.Notes || '' },
      { header: 'Created Timestamp', accessor: (s) => s.CreatedAt || '' },
    ];

    const timestamp = todayKey();
    const typeLabel = isMedpass ? 'Medpass' : 'Pharmacy';
    const tabSuffix = activeTab !== 'all' ? `_${activeTab}` : '';
    const filename = `MedUnited_${typeLabel}_Sales_${timestamp}${tabSuffix}.csv`;

    exportToCsv(filename, columns, exportData);
    onToast(`Exported ${exportData.length} ${typeLabel.toLowerCase()} records to CSV`, 'success');
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>{pageTitle}</h1>
          <p className="subtitle">
            {isMedpass
              ? 'Manage memberships, member inquiries, follow-ups, and sales'
              : 'Track prescription inquiries, home deliveries, and refill reminders'}
          </p>
        </div>
        <div className="topbar-actions">
          {canManageAll && (
            <button
              type="button"
              className="secondary"
              onClick={handleExportSales}
              title="Export filtered records to CSV (Managers & Admins only)"
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

          <button
            type="button"
            className="secondary"
            onClick={() => setImportOpen(true)}
            title="Add many leads at once from an Excel or CSV file"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 13px', fontWeight: 600 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <span>Import</span>
          </button>

          <div className="view-toggle">
            <button
              type="button"
              className={viewMode === 'board' ? 'active' : ''}
              onClick={() => setViewMode('board')}
            >
              Board
            </button>
            <button
              type="button"
              className={viewMode === 'table' ? 'active' : ''}
              onClick={() => setViewMode('table')}
            >
              Table
            </button>
          </div>
          <button type="button" onClick={openNewModal}>
            + New {isMedpass ? 'Medpass' : 'Pharmacy'} Record
          </button>
        </div>
      </div>

      <main>
        {isMedpass && canManageAll && (
          <PendingDiscountsPanel
            user={user}
            refreshKey={discountsKey}
            onToast={onToast}
            onChanged={loadData}
            onOpen={(id) => { const s = sales.find((x) => x.ID === id); if (s) openEditModal(s); }}
          />
        )}

        {/* Pipeline Tabs */}
        <div className="lead-tabs view-toggle" style={{ maxWidth: '780px', marginBottom: '16px' }}>
          {(['due', 'pending', 'completed', 'cancelled', 'all'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={activeTab === t ? 'active' : ''}
              onClick={() => setActiveTab(t)}
            >
              {t === 'due'
                ? 'Follow-ups due'
                : t === 'pending'
                ? 'Pending Pipeline'
                : t === 'cancelled'
                ? 'Lost / Cancelled'
                : t.charAt(0).toUpperCase() + t.slice(1)}
              <span className="tab-count"> ({tabCounts[t]})</span>
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="filter-bar">
          <input
            type="search"
            placeholder="Search by customer, phone, medicine or notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {canManageAll && (
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
              <option value="">All Agents</option>
              {agentOptions.map((a: any) => (
                <option key={a.email} value={a.email}>
                  {a.name}
                </option>
              ))}
            </select>
          )}

          <select value={tempFilter} onChange={(e) => setTempFilter(e.target.value)}>
            <option value="">All Temperatures</option>
            <option value="Hot">Hot</option>
            <option value="Warm">Warm</option>
            <option value="Cold">Cold</option>
          </select>

          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
            <option value="">All Channels</option>
            {options.channels.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
            <option value="">All Payment Methods</option>
            <option value="UPI">UPI</option>
            <option value="Cash">Cash</option>
            <option value="Card">Card</option>
            <option value="Net Banking">Net Banking</option>
          </select>

          {isMedpass && (
            <select value={priceTypeFilter} onChange={(e) => setPriceTypeFilter(e.target.value)}>
              <option value="">All Price Types</option>
              <option value="Full Price">Full Price</option>
              <option value="Discounted">Discounted</option>
              <option value="Converted From OP">Converted From OP</option>
            </select>
          )}

          {(search || agentFilter || tempFilter || channelFilter || paymentFilter || priceTypeFilter) && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSearch('');
                setAgentFilter('');
                setTempFilter('');
                setChannelFilter('');
                setPaymentFilter('');
                setPriceTypeFilter('');
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Board View */}
        {viewMode === 'board' && (
          <div className="kanban-board">
            {(['Pending', 'Completed', 'Cancelled'] as SaleStatus[]).map((colStatus) => {
              const colSales = filteredSales.filter((s) => s.Status === colStatus);
              const dotClass = colStatus.toLowerCase();
              return (
                <div key={colStatus} className="kanban-column">
                  <div className="kanban-column-header">
                    <span className={`dot ${dotClass}`} />
                    <span>{colStatus === 'Cancelled' ? 'Cancelled / Lost' : colStatus}</span>
                    <span className="count">{colSales.length}</span>
                  </div>

                  <div
                    className={`kanban-column-body ${dragOverCol === colStatus ? 'drag-over' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverCol !== colStatus) {
                        setDragOverCol(colStatus);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget === e.target) {
                        setDragOverCol(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverCol(null);
                      const saleId = e.dataTransfer.getData('text/plain') || draggedSaleId;
                      if (saleId) {
                        handleCardDrop(saleId, colStatus);
                      }
                    }}
                  >
                    {colSales.length === 0 ? (
                      <div className="kanban-empty-col">No {colStatus.toLowerCase()} entries</div>
                    ) : (
                      colSales.map((s) => {
                        const hasBill = !!s.BillScreenshotUrl;
                        const hasPay = !!s.PaymentScreenshotUrl;
                        const isOverdue = s.FollowUpStatus === 'overdue';
                        const isToday = s.FollowUpStatus === 'today';
                        const isAgentLocked = isCompletedLockedForAgent(s);

                        return (
                          <div
                            key={s.ID}
                            draggable={!isAgentLocked}
                            onDragStart={(e) => {
                              if (isAgentLocked) {
                                e.preventDefault();
                                return;
                              }
                              setIsDragging(true);
                              setDraggedSaleId(s.ID);
                              e.dataTransfer.setData('text/plain', s.ID);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              setDraggedSaleId(null);
                              setDragOverCol(null);
                              setTimeout(() => setIsDragging(false), 80);
                            }}
                            className={`kanban-card ${draggedSaleId === s.ID ? 'dragging' : ''}`}
                            style={{ cursor: isAgentLocked ? 'default' : 'grab' }}
                            onClick={() => {
                              if (!isDragging) {
                                openEditModal(s);
                              }
                            }}
                          >
                            <div className="kanban-card-top">
                              <span className="kanban-amount">{s.Amount ? formatMoney(s.Amount) : '—'}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {s.Temperature && (
                                  <span className={`temp-badge ${s.Temperature.toLowerCase()}`}>
                                    {s.Temperature}
                                  </span>
                                )}
                                <div className="kanban-proof-dots" title="Payment Proof">
                                  <span className={`proof-dot ${hasBill ? 'attached' : ''}`} title="Bill Proof" />
                                  <span className={`proof-dot ${hasPay ? 'attached' : ''}`} title="Payment Proof" />
                                </div>
                                {user.Role === 'admin' && (
                                  <button
                                    type="button"
                                    className="kanban-card-delete-btn"
                                    title="Delete record (Admin only - requires reason)"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openDeleteModal(s);
                                    }}
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="kanban-customer">
                              {s.CustomerName}
                              {s.DoNotCall && <span className="dnd-tag" style={{ marginLeft: '6px' }}>DND</span>}
                              {s.AlsoIn && s.AlsoIn.length > 0 && (
                                <span className="also-in-chip" title="This patient also has records in these modules">Also in: {s.AlsoIn.join(', ')}</span>
                              )}
                            </div>
                            <div className="muted small-text">{s.Contact || 'No phone'}</div>
                            <div className="kanban-detail">{s.Detail || 'No detail'}</div>
                            {!isMedpass && (
                              <button
                                type="button"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 8px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  background: '#eff6ff',
                                  color: '#1d4ed8',
                                  border: '1px solid #bfdbfe',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  marginTop: '4px',
                                  marginBottom: '6px',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditMedicationsModal(s);
                                }}
                                title="Edit prescribed medicines, dosages, and refill timing"
                              >
                                💊 Edit Meds
                              </button>
                            )}

                            {/* Follow up & attempt highlights */}
                            {s.Status === 'Pending' && s.NextFollowUp && (
                              <div style={{ marginBottom: '6px' }}>
                                {isOverdue && <span className="reminder-badge overdue small" style={{ marginRight: '4px' }}>Overdue</span>}
                                {isToday && <span className="reminder-badge upcoming small" style={{ marginRight: '4px' }}>Due Today</span>}
                                <small className="muted">{formatDate(s.NextFollowUp)}</small>
                              </div>
                            )}

                            {s.Status === 'Cancelled' && s.LostReason && (
                              <div style={{ fontSize: '0.75rem', color: '#dc2626', marginBottom: '6px' }}>
                                Lost: {s.LostReason}
                              </div>
                            )}

                            {s.AttemptCount !== undefined && s.AttemptCount > 0 && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                📞 {s.AttemptCount} contact attempt{s.AttemptCount === 1 ? '' : 's'}
                              </div>
                            )}

                            <div className="kanban-card-footer">
                              <div className="table-person">
                                <span className="avatar-sm">{initials(s.AgentName)}</span>
                                <span style={{ fontSize: '0.75rem' }}>{s.AgentName}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span className="kanban-payment-tag">
                                  {s.Channel || s.PaymentMethod || 'Inquiry'}
                                </span>
                                {user.Role === 'admin' && (
                                  <button
                                    type="button"
                                    className="kanban-card-delete-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openDeleteModal(s);
                                    }}
                                    title="Delete record (Admin only - requires reason)"
                                    aria-label="Delete record"
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Quick state change & reopen buttons */}
                            {s.Status === 'Cancelled' && (
                              <div className="kanban-quick-actions" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className="kanban-quick-btn success"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQuickReopen(s);
                                  }}
                                  title="Customer reached back out or interested - reopen to Pending"
                                >
                                  🔄 Customer Interested (Reopen)
                                </button>
                              </div>
                            )}

                            {s.Status === 'Pending' && (
                              <div className="kanban-quick-actions" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className="kanban-quick-btn success"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQuickComplete(s);
                                  }}
                                  title="Customer ready to buy service"
                                >
                                  💳 Ready to Buy
                                </button>
                                <button
                                  type="button"
                                  className="kanban-quick-btn danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQuickCancel(s);
                                  }}
                                  title="Mark as lost / cancelled"
                                >
                                  ✕ Lost
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Table View */}
        {viewMode === 'table' && (
          <div className="table-card">
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Temp</th>
                    <th>Source</th>
                    <th>{isMedpass ? 'Plan Detail' : 'Medicines'}</th>
                    <th>Amount</th>
                    <th>Follow-up / Due</th>
                    <th>Attempts</th>
                    <th>Proof</th>
                    {canManageAll && <th>Agent</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.length === 0 ? (
                    <tr>
                      <td colSpan={canManageAll ? 11 : 10} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                        No records match current criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredSales.map((s) => {
                      const isOverdue = s.FollowUpStatus === 'overdue';
                      const isToday = s.FollowUpStatus === 'today';

                      return (
                        <tr
                          key={s.ID}
                          className="lead-row"
                          onClick={() => openEditModal(s)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <strong>{s.CustomerName}</strong>
                            {s.DoNotCall && <span className="dnd-tag" style={{ marginLeft: '6px' }}>DND</span>}
                            {s.AlsoIn && s.AlsoIn.length > 0 && (
                                <span className="also-in-chip" title="This patient also has records in these modules">Also in: {s.AlsoIn.join(', ')}</span>
                              )}
                            <div>
                              <small className="muted">{s.Contact || '—'}</small>
                            </div>
                          </td>

                          <td>
                            <span className={`status-pill stage-${s.Status.toLowerCase()}`}>{s.Status}</span>
                            {s.Status === 'Cancelled' && s.LostReason && (
                              <div>
                                <small className="muted">{s.LostReason}</small>
                              </div>
                            )}
                          </td>

                          <td>
                            {s.Temperature && (
                              <span className={`temp-badge ${s.Temperature.toLowerCase()}`}>{s.Temperature}</span>
                            )}
                          </td>

                          <td>
                            <div>{s.Channel || '—'}</div>
                            {s.HeardFrom && <small className="muted">{s.HeardFrom}</small>}
                          </td>

                          <td style={{ maxWidth: '200px' }} title={s.Detail}>
                            {s.Detail || '—'}
                          </td>

                          <td>
                            <strong>{s.Amount ? formatMoney(s.Amount) : '—'}</strong>
                          </td>

                          <td>
                            {s.NextFollowUp ? (
                              <div>
                                {isOverdue && <span className="reminder-badge overdue small" style={{ marginRight: '4px' }}>Overdue</span>}
                                {isToday && <span className="reminder-badge upcoming small" style={{ marginRight: '4px' }}>Today</span>}
                                <span>{formatDate(s.NextFollowUp)}</span>
                              </div>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>

                          <td>
                            <strong>{s.AttemptCount || 0}</strong>
                          </td>

                          <td>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {s.BillScreenshotUrl ? (
                                <button
                                  type="button"
                                  className="proof-link"
                                  style={{ border: 'none', cursor: 'pointer' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setProofModal({ title: `Bill Proof - ${s.CustomerName}`, url: s.BillScreenshotUrl, attachment: { type, saleId: s.ID, kind: 'bill' } });
                                  }}
                                >
                                  Bill
                                </button>
                              ) : (
                                <span className="proof-link disabled">No Bill</span>
                              )}
                              {s.PaymentScreenshotUrl ? (
                                <button
                                  type="button"
                                  className="proof-link"
                                  style={{ border: 'none', cursor: 'pointer' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setProofModal({ title: `Payment Proof - ${s.CustomerName}`, url: s.PaymentScreenshotUrl, attachment: { type, saleId: s.ID, kind: 'payment' } });
                                  }}
                                >
                                  Pay
                                </button>
                              ) : (
                                <span className="proof-link disabled">No Pay</span>
                              )}
                            </div>
                          </td>

                          {canManageAll && (
                            <td>
                              <div className="table-person">
                                <span className="avatar-sm">{initials(s.AgentName)}</span>
                                <span>{s.AgentName}</span>
                              </div>
                            </td>
                          )}

                          <td>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="secondary"
                                style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                                onClick={() => openEditModal(s)}
                              >
                                View
                              </button>
                              {!isMedpass && (
                                <button
                                  type="button"
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    background: '#eff6ff',
                                    color: '#1d4ed8',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                  }}
                                  onClick={() => openEditMedicationsModal(s)}
                                  title="Edit prescribed medicines, dosages, and refill duration"
                                >
                                  💊 Edit Meds
                                </button>
                              )}
                              {s.Status === 'Cancelled' && (
                                <button
                                  type="button"
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    background: '#dcfce7',
                                    color: '#166534',
                                    border: '1px solid #86efac',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                  }}
                                  onClick={() => handleQuickReopen(s)}
                                  title="Customer reached back out or interested in service"
                                >
                                  🔄 Reopen
                                </button>
                              )}
                              {user.Role === 'admin' && (
                                <button
                                  type="button"
                                  className="danger"
                                  style={{ padding: '4px 8px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                  onClick={() => openDeleteModal(s)}
                                  title="Delete record (Admin only - requires reason)"
                                >
                                  <span>🗑️</span> Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal / Detail Drawer */}
        {modalOpen && (
          <>
            <div className="overlay open" onClick={() => setModalOpen(false)} />
            <div className="sales-modal-popup open" role="dialog" aria-modal="true">
              {/* Modal Header */}
              <div className="modal-header-hero">
                <div className="modal-header-title">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h3>
                        {editingSale
                          ? editingSale.CustomerName
                          : `New ${isMedpass ? 'Medpass' : 'Pharmacy'} Record`}
                      </h3>
                      <span className="modal-header-badge">
                        {isMedpass ? 'Medpass Subscription' : 'Pharmacy Pipeline'}
                      </span>
                      {editingSale && (
                        <span className={`status-pill stage-${editingSale.Status.toLowerCase()}`}>
                          {editingSale.Status}
                        </span>
                      )}
                    </div>
                    <div className="modal-header-sub">
                      {editingSale
                        ? `Lead #${editingSale.ID} · Logged ${formatDate(editingSale.Date || todayKey())} · Assigned to ${editingSale.AgentEmail}`
                        : 'Follow the 3-step structured flow to capture customer, prescription & commercial details.'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {editingSale && (
                    <>
                      {editingSale.Temperature && (
                        <span className={`temp-badge ${editingSale.Temperature.toLowerCase()}`}>
                          {editingSale.Temperature}
                        </span>
                      )}
                      {editingSale.DoNotCall && <span className="dnd-tag">DND Restricted</span>}
                      {editingSale.AlsoIn && editingSale.AlsoIn.length > 0 && (
                        <span className="also-in-chip">Also in: {editingSale.AlsoIn.join(', ')}</span>
                      )}
                      {isMedpass && editingSale.PassStatus && (
                        <span className={`also-in-chip ${editingSale.PassStatus === 'expired' ? 'muted' : ''}`}>
                          {editingSale.PassStatus === 'active' ? 'Valid until' : 'Expired'} {formatDate(editingSale.ValidUntil || '')}
                        </span>
                      )}
                      {isMedpass && editingSale.DiscountStatus === 'Requested' && (
                        <>
                          <span className="also-in-chip" style={{ background: '#fef3c7', color: '#92400e' }}>Discount ₹{editingSale.DiscountAmount} waiting for approval</span>
                          {isSeniorRole(user.Role) && (
                            <>
                              <button type="button" style={{ padding: '4px 10px', fontSize: '0.78rem' }} onClick={() => decideDiscount(true)}>Approve</button>
                              <button type="button" className="secondary" style={{ padding: '4px 10px', fontSize: '0.78rem' }} onClick={() => decideDiscount(false)}>Reject</button>
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                  <button type="button" className="popup-close" onClick={() => setModalOpen(false)} title="Close">
                    &times;
                  </button>
                </div>
              </div>

              {/* Edit Mode Navigation Tabs (When editing an existing lead) */}
              {editingSale && (
                <div style={{ padding: '0 32px', background: '#ffffff', borderBottom: '1px solid #f1f5f9' }}>
                  <div className="edit-mode-tabs">
                    <button
                      type="button"
                      className={`edit-tab-btn ${editMainTab === 'details' && activeStep !== 2 ? 'active' : ''}`}
                      onClick={() => {
                        setEditMainTab('details');
                        setActiveStep(1);
                      }}
                    >
                      <span>📝</span> Record Details
                    </button>
                    {!isMedpass && (
                      <button
                        type="button"
                        className={`edit-tab-btn ${editMainTab === 'details' && activeStep === 2 ? 'active' : ''}`}
                        onClick={() => {
                          setEditMainTab('details');
                          setActiveStep(2);
                        }}
                      >
                        <span>💊</span> Prescribed Medications ({formProducts.filter(p => p.name.trim()).length || formProducts.length})
                      </button>
                    )}
                    <button
                      type="button"
                      className={`edit-tab-btn ${editMainTab === 'log_contact' ? 'active' : ''}`}
                      onClick={() => setEditMainTab('log_contact')}
                    >
                      <span>📞</span> Log Interaction / Contact
                    </button>
                    <button
                      type="button"
                      className={`edit-tab-btn ${editMainTab === 'history' ? 'active' : ''}`}
                      onClick={() => setEditMainTab('history')}
                    >
                      <span>🕒</span> History &amp; Audit Trail ({auditHistory.length + activities.length})
                    </button>
                  </div>
                </div>
              )}

              {/* Step Navigation Bar (Unboxed Stepper) */}
              {(!editingSale || editMainTab === 'details') && (
                <div className="stepper-container">
                  <div className="stepper-nav">
                    <button
                      type="button"
                      className={`stepper-step ${activeStep === 1 ? 'active' : ''} ${formCustomerName.trim() ? 'completed' : ''}`}
                      onClick={() => setActiveStep(1)}
                    >
                      <div className="step-num">{formCustomerName.trim() && activeStep > 1 ? '✓' : '1'}</div>
                      <div className="step-meta">
                        <span className="step-name">1. Customer &amp; Source</span>
                        <span className="step-hint">Profile, phone &amp; channel</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={`stepper-step ${activeStep === 2 ? 'active' : ''} ${(isMedpass ? formMembers.length > 0 : formProducts.some((p) => p.name.trim())) ? 'completed' : ''}`}
                      onClick={() => {
                        if (formCustomerName.trim() || editingSale) setActiveStep(2);
                      }}
                    >
                      <div className="step-num">
                        {(isMedpass ? formMembers.length > 0 : formProducts.some((p) => p.name.trim())) && activeStep > 2 ? '✓' : '2'}
                      </div>
                      <div className="step-meta">
                        <span className="step-name">{isMedpass ? '2. Medpass Plan' : '2. Medicines &amp; Dosing'}</span>
                        <span className="step-hint">{isMedpass ? 'Plan tier & pricing' : 'Dosages & refill cycles'}</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={`stepper-step ${activeStep === 3 ? 'active' : ''}`}
                      onClick={() => {
                        if (
                          (formCustomerName.trim() &&
                            (isMedpass ? formMembers.length > 0 : formProducts.some((p) => p.name.trim()))) ||
                          editingSale
                        ) {
                          setActiveStep(3);
                        }
                      }}
                    >
                      <div className="step-num">3</div>
                      <div className="step-meta">
                        <span className="step-name">3. Pipeline &amp; Payment</span>
                        <span className="step-hint">Status, follow-up &amp; proof</span>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Modal Body */}
              <div className="popup-body" style={{ padding: '24px 32px', background: '#ffffff', flex: 1, overflowY: 'auto' }}>
                {formError && <div className="form-error show" style={{ marginBottom: '16px' }}>{formError}</div>}

                {isFinancialLocked && (
                  <div
                    className="form-error show"
                    style={{ background: '#fef3c7', color: '#92400e', marginBottom: '16px' }}
                  >
                    🔒 Financial amount &amp; payment proofs are locked on Completed sales. Prescribed medications, dosages, and notes can still be edited freely.
                  </div>
                )}

                {/* Duplicate Phone Warning */}
                {contactWarning && (
                  <div
                    className={`contact-check ${contactWarning.blocking ? 'blocking' : ''}`}
                    style={{ marginBottom: '16px' }}
                  >
                    {contactWarning.message}
                  </div>
                )}

                {!editingSale && activeStep === 1 && contactInfo && contactInfo.people.length > 0 && (
                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label htmlFor="person-choice">Who is this? (people already on this number)</label>
                    <select
                      id="person-choice"
                      value={personChoice}
                      onChange={(e) => {
                        const p = contactInfo.people.find((x) => x.Name === e.target.value);
                        setPersonChoice(e.target.value);
                        setFormPatientId(p ? p.ID : '');
                        if (p) setFormCustomerName(p.Name);
                      }}
                    >
                      <option value="">Someone new on this number (family member, relative…)</option>
                      {contactInfo.people.map((p) => (
                        <option key={p.Name} value={p.Name}>
                          {p.Name}
                          {p.OpenModules.length > 0 ? ` — open in ${p.OpenModules.join(', ')}` : ''}
                          {p.OwnerName && !p.Mine ? ` · handled by ${p.OwnerName}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {!editingSale && activeStep === 1 && canManageAll && (
                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label htmlFor="assign-to">Assign to</label>
                    {lockedOwner ? (
                      <div className="contact-check">Already handled by {lockedOwner.name} — the record goes to them.</div>
                    ) : (
                      <select id="assign-to" value={formAgentEmail} onChange={(e) => setFormAgentEmail(e.target.value)}>
                        <option value={user.Email}>Me ({user.Name})</option>
                        {agentRoster
                          .filter((a) => a.Email.toLowerCase() !== user.Email.toLowerCase())
                          .map((a) => (
                            <option key={a.Email} value={a.Email}>
                              {a.Name}{a.Role === 'manager' ? ' (manager)' : ''}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                )}

                {/* Reopen / Customer Contacted Back Callout Banner */}
                {editingSale && editingSale.Status === 'Cancelled' && (
                  <div className="reopen-banner" style={{ marginBottom: '20px' }}>
                    <div className="reopen-banner-text">
                      <div className="reopen-banner-title">
                        <span>📞</span> Customer Contacted Back or Interested in Buying?
                      </div>
                      <div className="reopen-banner-desc">
                        If this customer called back, messaged on WhatsApp, or is ready to buy the service, click below to reopen the lead back to active Pending follow-up with Hot priority.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="reopen-banner-btn"
                      onClick={() => handleReopenLead(editingSale)}
                    >
                      🔄 Reopen Lead (Set to Pending &amp; Hot)
                    </button>
                  </div>
                )}

                {/* Manager Reassign section */}
                {editingSale && canManageAll && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '20px',
                      paddingBottom: '16px',
                      borderBottom: '1px solid #f1f5f9',
                    }}
                  >
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Assigned Agent:
                    </span>
                    {(editingSale.HouseholdSize || 1) > 1 && (
                      <select
                        aria-label="Who to reassign"
                        value={reassignScope}
                        onChange={(e) => setReassignScope(e.target.value as 'household' | 'person')}
                        style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                        title="Everyone on this phone number, or only this person"
                      >
                        <option value="household">Everyone on this number ({editingSale.HouseholdSize})</option>
                        <option value="person">Only {editingSale.CustomerName}</option>
                      </select>
                    )}
                    <select
                      value={editingSale.AgentEmail}
                      onChange={(e) => handleReassignSale(e.target.value)}
                      style={{ flex: 1, padding: '6px 10px', fontSize: '0.85rem' }}
                    >
                      {agentRoster.map((a) => (
                        <option key={a.Email} value={a.Email}>
                          {a.Name} ({a.Email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* TAB 1: RECORD DETAILS (Multi-Step Unboxed View) */}
                {(!editingSale || editMainTab === 'details') && (
                  <form onSubmit={handleSaveSale}>
                    {/* STEP 1: CUSTOMER & SOURCE */}
                    {activeStep === 1 && (
                      <div>
                        {/* Customer Information Block */}
                        <div className="form-section-block">
                          <div className="form-section-header">
                            <div className="form-section-title">
                              <span className="title-text">👤 Customer Information</span>
                            </div>
                            <div className="form-section-desc">Primary contact details &amp; preferences</div>
                          </div>

                          <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }}>
                            <div>
                              <label>Customer Name *</label>
                              <input
                                type="text"
                                required
                                disabled={isLocked}
                                value={formCustomerName}
                                onChange={(e) => setFormCustomerName(e.target.value)}
                                placeholder="e.g. Ramesh Kumar"
                                autoFocus
                              />
                            </div>
                            <div>
                              <label>Phone Number</label>
                              <input
                                type="text"
                                disabled={isLocked}
                                value={formContact}
                                onChange={(e) => setFormContact(e.target.value)}
                                placeholder="e.g. 9848012345"
                              />
                            </div>
                          </div>

                          {/* Consent & DND Toggles */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                            <label className="clean-toggle-row">
                              <input
                                type="checkbox"
                                disabled={isLocked}
                                checked={formConsent}
                                onChange={(e) => !isLocked && setFormConsent(e.target.checked)}
                              />
                              <div className="clean-toggle-content">
                                <span className="clean-toggle-title">Consent Received</span>
                                <span className="clean-toggle-desc">Customer authorized communication &amp; messaging</span>
                              </div>
                            </label>

                            <label className="clean-toggle-row">
                              <input
                                type="checkbox"
                                disabled={isLocked}
                                checked={formDoNotCall}
                                onChange={(e) => !isLocked && setFormDoNotCall(e.target.checked)}
                              />
                              <div className="clean-toggle-content">
                                <span
                                  className="clean-toggle-title"
                                  style={{ color: formDoNotCall ? '#dc2626' : 'inherit' }}
                                >
                                  Do Not Call (DND)
                                </span>
                                <span className="clean-toggle-desc">
                                  {formDoNotCall ? 'Restricts outgoing promotional calls' : 'Normal outbound contact allowed'}
                                </span>
                              </div>
                            </label>
                          </div>
                        </div>

                        {/* Lead Source & Qualification Block */}
                        <div className="form-section-block">
                          <div className="form-section-header">
                            <div className="form-section-title">
                              <span className="title-text">🎯 Lead Qualification &amp; Source</span>
                            </div>
                            <div className="form-section-desc">Buying intent, direction and attribution channel</div>
                          </div>

                          {/* Lead Temperature Selector */}
                          <div style={{ marginBottom: '16px' }}>
                            <label style={{ marginBottom: '6px' }}>Lead Temperature</label>
                            <div className="segmented-pill-group">
                              <button
                                type="button"
                                disabled={isLocked}
                                className={`segmented-pill-btn ${formTemperature === 'Hot' ? 'active-hot' : ''}`}
                                onClick={() => setFormTemperature('Hot')}
                              >
                                🔥 Hot (High Buying Intent)
                              </button>
                              <button
                                type="button"
                                disabled={isLocked}
                                className={`segmented-pill-btn ${formTemperature === 'Warm' ? 'active-warm' : ''}`}
                                onClick={() => setFormTemperature('Warm')}
                              >
                                ☀️ Warm (Evaluating / Open)
                              </button>
                              <button
                                type="button"
                                disabled={isLocked}
                                className={`segmented-pill-btn ${formTemperature === 'Cold' ? 'active-cold' : ''}`}
                                onClick={() => setFormTemperature('Cold')}
                              >
                                ❄️ Cold (General Enquiry)
                              </button>
                            </div>
                          </div>

                          {/* Direction & Acquisition Channel */}
                          <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '16px' }}>
                            <div>
                              <label>Lead Direction</label>
                              <div className="segmented-pill-group">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  className={`segmented-pill-btn ${formDirection === 'Inbound' ? 'active-primary' : ''}`}
                                  onClick={() => setFormDirection('Inbound')}
                                >
                                  📥 Inbound (Customer Inquired)
                                </button>
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  className={`segmented-pill-btn ${formDirection === 'Outbound' ? 'active-primary' : ''}`}
                                  onClick={() => setFormDirection('Outbound')}
                                >
                                  📤 Outbound (Agent Reached Out)
                                </button>
                              </div>
                            </div>

                            <div>
                              <label>Acquisition Channel</label>
                              <select
                                value={formChannel}
                                disabled={isLocked}
                                onChange={(e) => setFormChannel(e.target.value)}
                              >
                                {options.channels.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {formDirection === 'Inbound' && (
                            <div style={{ marginTop: '16px' }}>
                              <label>How they heard about us</label>
                              <select
                                value={formHeardFrom}
                                disabled={isLocked}
                                onChange={(e) => setFormHeardFrom(e.target.value)}
                              >
                                <option value="">Not asked / Unknown</option>
                                {options.heardFrom.map((h) => (
                                  <option key={h} value={h}>
                                    {h}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* STEP 2: PRESCRIPTION, ITEMS & PRICING */}
                    {activeStep === 2 && (
                      <div>
                        {/* Commercial Pricing Block */}
                        <div className="form-section-block">
                          <div className="form-section-header">
                            <div className="form-section-title">
                              <span className="title-text">💰 Order Date &amp; Financials</span>
                            </div>
                            <div className="form-section-desc">Total deal value and booking date</div>
                          </div>

                          <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '16px' }}>
                            <div>
                              <label>Record Date</label>
                              <input
                                type="date"
                                disabled={isLocked}
                                value={formDate}
                                onChange={(e) => setFormDate(e.target.value)}
                              />
                            </div>

                            {isMedpass ? (
                              <div>
                                <label>Price</label>
                                {quote ? <MedpassQuoteBox quote={quote} priceType={formPriceType} legacyAmount={medpassLegacyAmount}
                                  discountStatus={editingSale && Number(formDiscount) === editingSale.DiscountAmount ? editingSale.DiscountStatus : ''} /> : <div className="muted small-text">Loading prices…</div>}
                              </div>
                            ) : (
                            <div>
                              <label>Total Amount (₹) *</label>
                              <div style={{ position: 'relative' }}>
                                <span
                                  style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: '#64748b',
                                    fontWeight: 700,
                                    fontSize: '0.95rem',
                                  }}
                                >
                                  ₹
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  required
                                  disabled={isLocked}
                                  value={formAmount}
                                  onChange={(e) => setFormAmount(e.target.value)}
                                  placeholder="0.00"
                                  style={{ paddingLeft: '28px', fontWeight: 600, fontSize: '1rem' }}
                                />
                              </div>
                            </div>
                            )}
                          </div>
                        </div>

                        {/* Pharmacy Specific: Medicines List with Refill Countdown */}
                        {!isMedpass && (
                          <div className="form-section-block">
                            <div className="form-section-header">
                              <div className="form-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
                                <span className="title-text">💊 Prescribed Medicines &amp; Dosage Forms</span>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  <button
                                    type="button"
                                    className="secondary"
                                    style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    onClick={() =>
                                      setFormProducts([
                                        ...formProducts,
                                        {
                                          name: '',
                                          quantity: 30,
                                          frequency: 'Once a day',
                                          unitsPerDose: 1,
                                          formType: 'tablet',
                                          unitName: 'tabs',
                                        },
                                      ])
                                    }
                                  >
                                    <span>+</span> Add Medicine
                                  </button>
                                  {editingSale && (
                                    <button
                                      type="button"
                                      disabled={saving}
                                      onClick={handleSaveMedicationsOnly}
                                      style={{
                                        padding: '4px 12px',
                                        fontSize: '0.78rem',
                                        fontWeight: 600,
                                        background: '#16a34a',
                                        color: '#ffffff',
                                        borderRadius: '6px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                      title="Save prescribed medication updates immediately without going to step 3"
                                    >
                                      <span>💾</span> Save Medications
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="form-section-desc">
                                Supports tablets, syrups (ml), inhalers (puffs), drops, creams, injections, and custom doctor course days
                              </div>
                            </div>

                            <div className="meds-list-container">
                              {formProducts.map((p, idx) => {
                                const formType: MedicineForm = p.formType || 'tablet';
                                const refillDays = getRefillDays(p);

                                return (
                                  <div key={idx} className="med-item-card">
                                    {/* Top Line: Name, Dosage Form Selector, and Delete */}
                                    <div className="med-item-header">
                                      <div>
                                        <label style={{ marginBottom: '4px' }}>Medicine Name *</label>
                                        <input
                                          type="text"
                                          placeholder={
                                            formType === 'syrup'
                                              ? 'e.g. Cough Syrup (Ascoril / Benadryl)'
                                              : formType === 'inhaler'
                                              ? 'e.g. Asthalin Inhaler, Budecort'
                                              : formType === 'drops'
                                              ? 'e.g. Ciplox Eye Drops, Otrivin'
                                              : formType === 'cream'
                                              ? 'e.g. Volini Gel, Betnovate Cream'
                                              : formType === 'injection'
                                              ? 'e.g. Lantus Insulin Solostar Pen'
                                              : formType === 'course'
                                              ? 'e.g. Azithromycin 500mg'
                                              : 'e.g. Metformin 500mg, Telmisartan'
                                          }
                                          disabled={isLocked}
                                          value={p.name}
                                          onChange={(e) => {
                                            const copy = [...formProducts];
                                            copy[idx].name = e.target.value;
                                            setFormProducts(copy);
                                          }}
                                        />
                                      </div>

                                      <div>
                                        <label style={{ marginBottom: '4px' }}>Dosage Form</label>
                                        <select
                                          disabled={isLocked}
                                          value={formType}
                                          onChange={(e) => {
                                            const newForm = e.target.value as MedicineForm;
                                            const copy = [...formProducts];
                                            copy[idx].formType = newForm;
                                            if (newForm === 'syrup') {
                                              copy[idx].unitName = 'ml';
                                              copy[idx].bottleVolume = copy[idx].bottleVolume || 100;
                                              copy[idx].bottlesCount = copy[idx].bottlesCount || 1;
                                              copy[idx].quantity = copy[idx].bottleVolume;
                                              copy[idx].unitsPerDose = copy[idx].unitsPerDose && copy[idx].unitsPerDose > 1 ? copy[idx].unitsPerDose : 5;
                                            } else if (newForm === 'inhaler') {
                                              copy[idx].unitName = 'puffs';
                                              copy[idx].quantity = 200;
                                              copy[idx].bottlesCount = 1;
                                              copy[idx].unitsPerDose = 2;
                                            } else if (newForm === 'drops') {
                                              copy[idx].unitName = 'drops';
                                              copy[idx].quantity = 1;
                                              copy[idx].unitsPerDose = 2;
                                              copy[idx].customDays = copy[idx].customDays || 15;
                                            } else if (newForm === 'cream') {
                                              copy[idx].unitName = 'tubes';
                                              copy[idx].quantity = 1;
                                              copy[idx].unitsPerDose = 1;
                                              copy[idx].customDays = copy[idx].customDays || 15;
                                            } else if (newForm === 'injection') {
                                              copy[idx].unitName = 'units';
                                              copy[idx].quantity = 300;
                                              copy[idx].unitsPerDose = 20;
                                            } else if (newForm === 'course') {
                                              copy[idx].unitName = 'days';
                                              copy[idx].customDays = copy[idx].customDays || 7;
                                              copy[idx].quantity = copy[idx].customDays || 7;
                                            } else {
                                              copy[idx].unitName = 'tabs';
                                              copy[idx].quantity = 30;
                                              copy[idx].unitsPerDose = 1;
                                            }
                                            setFormProducts(copy);
                                          }}
                                        >
                                          <option value="tablet">💊 Tablets / Capsules</option>
                                          <option value="syrup">🧪 Syrup / Liquid (ml)</option>
                                          <option value="inhaler">💨 Inhaler / Spray (puffs)</option>
                                          <option value="drops">💧 Eye / Ear Drops</option>
                                          <option value="cream">🧴 Ointment / Cream</option>
                                          <option value="injection">💉 Insulin / Injection</option>
                                          <option value="sachet">📦 Sachet / Powder</option>
                                          <option value="course">⏱️ Fixed Course (Days)</option>
                                        </select>
                                      </div>

                                      {formProducts.length > 1 && !isLocked ? (
                                        <button
                                          type="button"
                                          className="danger"
                                          style={{ padding: '4px', height: '38px', width: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                          onClick={() => {
                                            const copy = formProducts.filter((_, i) => i !== idx);
                                            setFormProducts(copy);
                                          }}
                                          title="Remove medication"
                                        >
                                          &times;
                                        </button>
                                      ) : (
                                        <div />
                                      )}
                                    </div>

                                    {/* Middle Controls Grid: Dynamically adapted to formType */}
                                    {formType === 'syrup' ? (
                                      <div className="med-fields-grid grid-5">
                                        <div>
                                          <label>Bottle Size (ml)</label>
                                          <input
                                            type="number"
                                            min="10"
                                            placeholder="100"
                                            disabled={isLocked}
                                            value={p.bottleVolume || p.quantity || 100}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              const vol = Number(e.target.value) || 0;
                                              copy[idx].bottleVolume = vol;
                                              copy[idx].quantity = vol;
                                              setFormProducts(copy);
                                            }}
                                          />
                                          {!isLocked && (
                                            <div className="med-quick-chips">
                                              {[60, 100, 150, 200].map((ml) => (
                                                <span
                                                  key={ml}
                                                  className={`med-chip ${(p.bottleVolume || p.quantity) === ml ? 'active' : ''}`}
                                                  onClick={() => {
                                                    const copy = [...formProducts];
                                                    copy[idx].bottleVolume = ml;
                                                    copy[idx].quantity = ml;
                                                    setFormProducts(copy);
                                                  }}
                                                >
                                                  {ml}ml
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div>
                                          <label>Bottles</label>
                                          <input
                                            type="number"
                                            min="1"
                                            placeholder="1"
                                            disabled={isLocked}
                                            value={p.bottlesCount || 1}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].bottlesCount = Number(e.target.value) || 1;
                                              setFormProducts(copy);
                                            }}
                                          />
                                        </div>

                                        <div>
                                          <label>Dose (ml)</label>
                                          <input
                                            type="number"
                                            step="0.5"
                                            min="0.5"
                                            placeholder="5"
                                            disabled={isLocked}
                                            value={p.unitsPerDose || 5}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].unitsPerDose = Number(e.target.value) || 5;
                                              setFormProducts(copy);
                                            }}
                                          />
                                          {!isLocked && (
                                            <div className="med-quick-chips">
                                              {[
                                                { label: '2.5ml', val: 2.5 },
                                                { label: '5ml (1 tsp)', val: 5 },
                                                { label: '10ml (1 tbsp)', val: 10 },
                                              ].map((c) => (
                                                <span
                                                  key={c.val}
                                                  className={`med-chip ${p.unitsPerDose === c.val ? 'active' : ''}`}
                                                  onClick={() => {
                                                    const copy = [...formProducts];
                                                    copy[idx].unitsPerDose = c.val;
                                                    setFormProducts(copy);
                                                  }}
                                                >
                                                  {c.label}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div>
                                          <label>Frequency</label>
                                          <select
                                            disabled={isLocked}
                                            value={p.frequency}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].frequency = e.target.value as any;
                                              setFormProducts(copy);
                                            }}
                                          >
                                            <option value="Once a day">Once a day (1/d)</option>
                                            <option value="Twice a day">Twice a day (2/d)</option>
                                            <option value="Thrice a day">Thrice a day (3/d)</option>
                                          </select>
                                        </div>

                                        <div>
                                          <label>Refill Cycle</label>
                                          <div className="refill-badge">
                                            {refillDays ? `~${refillDays} days` : '—'}
                                          </div>
                                        </div>
                                      </div>
                                    ) : formType === 'inhaler' ? (
                                      <div className="med-fields-grid grid-5">
                                        <div>
                                          <label>Canister (Puffs)</label>
                                          <input
                                            type="number"
                                            min="10"
                                            placeholder="200"
                                            disabled={isLocked}
                                            value={p.quantity || 200}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].quantity = Number(e.target.value) || 200;
                                              setFormProducts(copy);
                                            }}
                                          />
                                          {!isLocked && (
                                            <div className="med-quick-chips">
                                              {[120, 200].map((pf) => (
                                                <span
                                                  key={pf}
                                                  className={`med-chip ${p.quantity === pf ? 'active' : ''}`}
                                                  onClick={() => {
                                                    const copy = [...formProducts];
                                                    copy[idx].quantity = pf;
                                                    setFormProducts(copy);
                                                  }}
                                                >
                                                  {pf} puffs
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div>
                                          <label>Canisters</label>
                                          <input
                                            type="number"
                                            min="1"
                                            disabled={isLocked}
                                            value={p.bottlesCount || 1}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].bottlesCount = Number(e.target.value) || 1;
                                              setFormProducts(copy);
                                            }}
                                          />
                                        </div>

                                        <div>
                                          <label>Puffs / Dose</label>
                                          <input
                                            type="number"
                                            min="1"
                                            disabled={isLocked}
                                            value={p.unitsPerDose || 2}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].unitsPerDose = Number(e.target.value) || 2;
                                              setFormProducts(copy);
                                            }}
                                          />
                                          {!isLocked && (
                                            <div className="med-quick-chips">
                                              {[1, 2].map((pf) => (
                                                <span
                                                  key={pf}
                                                  className={`med-chip ${p.unitsPerDose === pf ? 'active' : ''}`}
                                                  onClick={() => {
                                                    const copy = [...formProducts];
                                                    copy[idx].unitsPerDose = pf;
                                                    setFormProducts(copy);
                                                  }}
                                                >
                                                  {pf} puff{pf > 1 ? 's' : ''}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div>
                                          <label>Frequency</label>
                                          <select
                                            disabled={isLocked}
                                            value={p.frequency}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].frequency = e.target.value as any;
                                              setFormProducts(copy);
                                            }}
                                          >
                                            <option value="Once a day">Once a day</option>
                                            <option value="Twice a day">Twice a day</option>
                                            <option value="Thrice a day">Thrice a day</option>
                                          </select>
                                        </div>

                                        <div>
                                          <label>Refill Cycle</label>
                                          <div className="refill-badge">
                                            {refillDays ? `~${refillDays} days` : '—'}
                                          </div>
                                        </div>
                                      </div>
                                    ) : formType === 'drops' || formType === 'cream' ? (
                                      <div className="med-fields-grid grid-4">
                                        <div>
                                          <label>{formType === 'drops' ? 'Bottles Count' : 'Tubes Count'}</label>
                                          <input
                                            type="number"
                                            min="1"
                                            disabled={isLocked}
                                            value={p.quantity || 1}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].quantity = Number(e.target.value) || 1;
                                              setFormProducts(copy);
                                            }}
                                          />
                                        </div>

                                        <div>
                                          <label>Course Duration (Days)</label>
                                          <input
                                            type="number"
                                            min="1"
                                            disabled={isLocked}
                                            value={p.customDays || 15}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].customDays = Number(e.target.value) || 15;
                                              setFormProducts(copy);
                                            }}
                                          />
                                          {!isLocked && (
                                            <div className="med-quick-chips">
                                              {[7, 10, 15, 30].map((d) => (
                                                <span
                                                  key={d}
                                                  className={`med-chip ${(p.customDays || 15) === d ? 'active' : ''}`}
                                                  onClick={() => {
                                                    const copy = [...formProducts];
                                                    copy[idx].customDays = d;
                                                    setFormProducts(copy);
                                                  }}
                                                >
                                                  {d}d
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div>
                                          <label>Frequency</label>
                                          <select
                                            disabled={isLocked}
                                            value={p.frequency}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].frequency = e.target.value as any;
                                              setFormProducts(copy);
                                            }}
                                          >
                                            <option value="Once a day">Once a day</option>
                                            <option value="Twice a day">Twice a day</option>
                                            <option value="Thrice a day">Thrice a day</option>
                                          </select>
                                        </div>

                                        <div>
                                          <label>Refill Cycle</label>
                                          <div className="refill-badge">
                                            {refillDays ? `~${refillDays} days` : '—'}
                                          </div>
                                        </div>
                                      </div>
                                    ) : formType === 'course' ? (
                                      <div className="med-fields-grid" style={{ gridTemplateColumns: '2fr 1.5fr 1fr' }}>
                                        <div>
                                          <label>Prescription Course Duration (Days) *</label>
                                          <input
                                            type="number"
                                            min="1"
                                            disabled={isLocked}
                                            value={p.customDays || p.quantity || 7}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              const d = Number(e.target.value) || 7;
                                              copy[idx].customDays = d;
                                              copy[idx].quantity = d;
                                              setFormProducts(copy);
                                            }}
                                          />
                                          {!isLocked && (
                                            <div className="med-quick-chips">
                                              {[3, 5, 7, 10, 14, 30, 60, 90].map((d) => (
                                                <span
                                                  key={d}
                                                  className={`med-chip ${(p.customDays || p.quantity || 7) === d ? 'active' : ''}`}
                                                  onClick={() => {
                                                    const copy = [...formProducts];
                                                    copy[idx].customDays = d;
                                                    copy[idx].quantity = d;
                                                    setFormProducts(copy);
                                                  }}
                                                >
                                                  {d} days
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div>
                                          <label>Daily Frequency</label>
                                          <select
                                            disabled={isLocked}
                                            value={p.frequency}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].frequency = e.target.value as any;
                                              setFormProducts(copy);
                                            }}
                                          >
                                            <option value="Once a day">Once a day</option>
                                            <option value="Twice a day">Twice a day</option>
                                            <option value="Thrice a day">Thrice a day</option>
                                          </select>
                                        </div>

                                        <div>
                                          <label>Refill Cycle</label>
                                          <div className="refill-badge">
                                            Fixed ~{refillDays} days
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      /* Default: Tablets / Capsules */
                                      <div className="med-fields-grid grid-4">
                                        <div>
                                          <label>Pack Qty (Tablets)</label>
                                          <input
                                            type="number"
                                            min="1"
                                            placeholder="30"
                                            disabled={isLocked}
                                            value={p.quantity}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].quantity = Number(e.target.value) || 0;
                                              setFormProducts(copy);
                                            }}
                                          />
                                          {!isLocked && (
                                            <div className="med-quick-chips">
                                              {[10, 15, 30, 60, 90].map((t) => (
                                                <span
                                                  key={t}
                                                  className={`med-chip ${p.quantity === t ? 'active' : ''}`}
                                                  onClick={() => {
                                                    const copy = [...formProducts];
                                                    copy[idx].quantity = t;
                                                    setFormProducts(copy);
                                                  }}
                                                >
                                                  {t} tabs
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div>
                                          <label>Units / Dose</label>
                                          <input
                                            type="number"
                                            step="0.5"
                                            min="0.5"
                                            placeholder="1"
                                            disabled={isLocked}
                                            value={p.unitsPerDose}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].unitsPerDose = Number(e.target.value) || 1;
                                              setFormProducts(copy);
                                            }}
                                          />
                                          {!isLocked && (
                                            <div className="med-quick-chips">
                                              {[0.5, 1, 2].map((u) => (
                                                <span
                                                  key={u}
                                                  className={`med-chip ${p.unitsPerDose === u ? 'active' : ''}`}
                                                  onClick={() => {
                                                    const copy = [...formProducts];
                                                    copy[idx].unitsPerDose = u;
                                                    setFormProducts(copy);
                                                  }}
                                                >
                                                  {u} tab{u > 1 ? 's' : ''}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div>
                                          <label>Frequency</label>
                                          <select
                                            disabled={isLocked}
                                            value={p.frequency}
                                            onChange={(e) => {
                                              const copy = [...formProducts];
                                              copy[idx].frequency = e.target.value as any;
                                              setFormProducts(copy);
                                            }}
                                          >
                                            <option value="Once a day">Once a day (1/d)</option>
                                            <option value="Twice a day">Twice a day (2/d)</option>
                                            <option value="Thrice a day">Thrice a day (3/d)</option>
                                          </select>
                                        </div>

                                        <div>
                                          <label>Refill Cycle</label>
                                          <div className="refill-badge">
                                            {refillDays ? `~${refillDays} days` : '—'}
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    {/* Bottom strip: Clinical explanation & Custom Days Override */}
                                    <div className="med-summary-strip">
                                      <div className="calc-text">
                                        <span>
                                          {formType === 'syrup'
                                            ? `🧪 ${(p.bottlesCount || 1) > 1 ? `${p.bottlesCount} bottles of ` : ''}${p.bottleVolume || p.quantity || 100}ml @ ${p.unitsPerDose || 5}ml ${p.frequency.toLowerCase()} → lasts ~${refillDays || 0} days`
                                            : formType === 'inhaler'
                                            ? `💨 ${(p.bottlesCount || 1) > 1 ? `${p.bottlesCount} canisters of ` : ''}${p.quantity || 200} puffs @ ${p.unitsPerDose || 2} puffs ${p.frequency.toLowerCase()} → lasts ~${refillDays || 0} days`
                                            : formType === 'drops'
                                            ? `💧 ${p.quantity || 1} bottle eye/ear drops (${p.unitsPerDose || 2} drops ${p.frequency.toLowerCase()}) → ~${refillDays || 0} days course`
                                            : formType === 'cream'
                                            ? `🧴 ${p.quantity || 1} tube cream/gel (${p.frequency.toLowerCase()}) → ~${refillDays || 0} days course`
                                            : formType === 'course'
                                            ? `⏱️ Fixed prescription course of ~${refillDays || 7} days (${p.frequency.toLowerCase()})`
                                            : `💊 ${p.quantity} tablets @ ${p.unitsPerDose} tab ${p.frequency.toLowerCase()} → lasts ~${refillDays || 0} days`}
                                        </span>
                                      </div>

                                      {!isLocked && formType !== 'course' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          {p.customDays ? (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#4338ca', fontWeight: 600 }}>
                                              Overridden to {p.customDays}d
                                              <button
                                                type="button"
                                                className="med-override-link"
                                                onClick={() => {
                                                  const copy = [...formProducts];
                                                  copy[idx].customDays = undefined;
                                                  setFormProducts(copy);
                                                }}
                                              >
                                                (reset to auto)
                                              </button>
                                            </span>
                                          ) : (
                                            <button
                                              type="button"
                                              className="med-override-link"
                                              onClick={() => {
                                                const days = prompt('Enter exact prescription duration in days:', String(refillDays || 10));
                                                if (days && Number(days) > 0) {
                                                  const copy = [...formProducts];
                                                  copy[idx].customDays = Number(days);
                                                  setFormProducts(copy);
                                                }
                                              }}
                                            >
                                              ✏️ Set custom days override
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Medpass Specific: Subscription Plan & Tier */}
                        {isMedpass && (
                          <div className="form-section-block">
                            <div className="form-section-header">
                              <div className="form-section-title">
                                <span className="title-text">📋 Medpass Membership Plan</span>
                              </div>
                              <div className="form-section-desc">Tier selection and price category</div>
                            </div>

                            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                              <div>
                                <label>Price Type *</label>
                                <select
                                  value={formPriceType}
                                  disabled={isLocked}
                                  onChange={(e) => setFormPriceType(e.target.value as PriceType)}
                                >
                                  <option value="Full Price">Full Price</option>
                                  <option value="Discounted">Discounted</option>
                                  <option value="Converted From OP">Converted From OP</option>
                                </select>
                              </div>
                              <div>
                                <label>Plan Detail</label>
                                <input
                                  type="text"
                                  disabled={isLocked}
                                  value={formDetail}
                                  onChange={(e) => setFormDetail(e.target.value)}
                                  placeholder="e.g. Medpass Senior Annual"
                                />
                              </div>
                            </div>

                            {formPriceType === 'Discounted' && (
                              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '12px' }}>
                                <div>
                                  <label htmlFor="mp-discount">Discount (₹, up to {medpassSettings?.maxDiscount ?? 200}) *</label>
                                  <input id="mp-discount" type="number" min="1" max={medpassSettings?.maxDiscount ?? 200} disabled={isFinancialLocked} value={formDiscount} onChange={(e) => setFormDiscount(e.target.value)} />
                                </div>
                                <div>
                                  <label htmlFor="mp-discount-reason">Reason for the discount *</label>
                                  <input id="mp-discount-reason" type="text" disabled={isFinancialLocked} value={formDiscountReason} onChange={(e) => setFormDiscountReason(e.target.value)} placeholder="e.g. Health camp offer" />
                                </div>
                                <div className="muted small-text" style={{ gridColumn: '1 / -1' }}>
                                  {editingSale?.DiscountStatus === 'Approved' ? `Approved by ${editingSale.DiscountDecidedBy}.` : editingSale?.DiscountStatus === 'Rejected' ? `Rejected by ${editingSale.DiscountDecidedBy}. Change the amount to ask again, or use Full Price.` : 'An admin or senior manager approves discounts before the sale can be completed.'}
                                </div>
                              </div>
                            )}

                            {formPriceType === 'Converted From OP' && (
                              <div style={{ marginTop: '12px', maxWidth: '320px' }}>
                                <label htmlFor="mp-op">OP consultation fee already paid (₹)</label>
                                <input id="mp-op" type="number" min="0" disabled={isFinancialLocked} value={formOpCredit} onChange={(e) => setFormOpCredit(e.target.value)} />
                                <div className="muted small-text">Credited against the pass (shown as a discount on the bill). The full price still counts as the sale. No other discount applies.</div>
                              </div>
                            )}

                            <div style={{ marginTop: '16px' }}>
                              <MedpassMembersEditor members={formMembers} onChange={setFormMembers} settings={medpassSettings} saleDate={formDate || todayKey()} disabled={isFinancialLocked} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* STEP 3: PIPELINE, PAYMENT & PROOF */}
                    {activeStep === 3 && (
                      <div>
                        {/* Pipeline Stage Block */}
                        <div className="form-section-block">
                          <div className="form-section-header">
                            <div className="form-section-title">
                              <span className="title-text">📊 Pipeline Status &amp; Follow-up</span>
                            </div>
                            <div className="form-section-desc">Current stage and follow-up timeline</div>
                          </div>

                          <div style={{ marginBottom: '16px' }}>
                            <label style={{ marginBottom: '6px' }}>Status *</label>
                            <div className="segmented-pill-group">
                              <button
                                type="button"
                                disabled={isLocked}
                                className={`segmented-pill-btn ${formStatus === 'Pending' ? 'active-pending' : ''}`}
                                onClick={() => setFormStatus('Pending')}
                              >
                                🟡 Pending (Open Pipeline)
                              </button>
                              <button
                                type="button"
                                disabled={isLocked}
                                className={`segmented-pill-btn ${formStatus === 'Completed' ? 'active-completed' : ''}`}
                                onClick={() => setFormStatus('Completed')}
                              >
                                🟢 Completed (Sale Closed)
                              </button>
                              <button
                                type="button"
                                disabled={isLocked}
                                className={`segmented-pill-btn ${formStatus === 'Cancelled' ? 'active-cancelled' : ''}`}
                                onClick={() => setFormStatus('Cancelled')}
                              >
                                🔴 Cancelled (Lost / Discarded)
                              </button>
                            </div>
                          </div>

                          {/* Dynamic Follow-up or Lost Reason */}
                          {formStatus === 'Cancelled' ? (
                            <div>
                              <label>Cancellation / Lost Reason *</label>
                              <select
                                value={formLostReason}
                                disabled={isLocked}
                                onChange={(e) => setFormLostReason(e.target.value)}
                              >
                                <option value="">Choose reason…</option>
                                {options.lostReasons.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <label>Next Follow-up Date</label>
                                <div className="quick-date-chips">
                                  <button
                                    type="button"
                                    className="quick-date-chip"
                                    onClick={() => setQuickFollowUp(1)}
                                  >
                                    + Tomorrow
                                  </button>
                                  <button
                                    type="button"
                                    className="quick-date-chip"
                                    onClick={() => setQuickFollowUp(3)}
                                  >
                                    + 3 Days
                                  </button>
                                  <button
                                    type="button"
                                    className="quick-date-chip"
                                    onClick={() => setQuickFollowUp(7)}
                                  >
                                    + 1 Week
                                  </button>
                                </div>
                              </div>
                              <input
                                type="date"
                                disabled={isLocked}
                                value={formNextFollowUp}
                                onChange={(e) => setFormNextFollowUp(e.target.value)}
                              />
                            </div>
                          )}
                        </div>

                        {/* Payment & Documentation Block */}
                        <div className="form-section-block">
                          <div className="form-section-header">
                            <div className="form-section-title">
                              <span className="title-text">💳 Payment Method &amp; Documentation</span>
                            </div>
                            <div className="form-section-desc">
                              {formStatus === 'Completed'
                                ? 'Required to confirm commission accounting'
                                : 'Optional for pending leads'}
                            </div>
                          </div>

                          <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                            <div>
                              <label>Payment Method {formStatus === 'Completed' && '*'}</label>
                              <select
                                value={formPaymentMethod}
                                disabled={isLocked}
                                onChange={(e) => setFormPaymentMethod(e.target.value)}
                              >
                                <option value="">Select method…</option>
                                <option value="UPI">UPI</option>
                                <option value="Cash">Cash</option>
                                <option value="Card">Card</option>
                                <option value="Net Banking">Net Banking</option>
                              </select>
                            </div>

                            {formPaymentMethod === 'UPI' && (
                              <div>
                                <label>UPI UTR Number {formStatus === 'Completed' && '*'}</label>
                                <input
                                  type="text"
                                  disabled={isLocked}
                                  placeholder="e.g. 12-digit UPI UTR"
                                  value={formUtr}
                                  onChange={(e) => setFormUtr(e.target.value)}
                                />
                              </div>
                            )}
                          </div>

                          {/* Payment & Bill Proof Upload Dropzones */}
                          <div className="proof-dropzone-grid">
                            <div className={`proof-dropzone-box ${formBillScreenshot ? 'has-file' : ''}`}>
                              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                                Bill / Prescription Screenshot {formStatus === 'Completed' && <span style={{ color: 'var(--danger)' }}>*</span>}
                              </div>
                              {formBillScreenshot ? (
                                <div>
                                  <AttachmentImage
                                    value={formBillScreenshot}
                                    attachment={editingSale ? { type, saleId: editingSale.ID, kind: 'bill' } : null}
                                    alt="Bill Preview"
                                    className="proof-preview-thumb"
                                  />
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                    <button
                                      type="button"
                                      className="secondary"
                                      style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                                      onClick={() => setProofModal({ title: 'Bill Preview', url: formBillScreenshot, attachment: editingSale ? { type, saleId: editingSale.ID, kind: 'bill' } : null })}
                                    >
                                      Preview
                                    </button>
                                    {!isFinancialLocked && (
                                      <button
                                        type="button"
                                        className="danger"
                                        style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                                        onClick={() => setFormBillScreenshot('')}
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div style={{ fontSize: '1.4rem', color: '#94a3b8', marginBottom: '4px' }}>📄</div>
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    disabled={isFinancialLocked}
                                    onChange={(e) => handleFileUpload(e, 'bill')}
                                    style={{ fontSize: '0.78rem' }}
                                  />
                                </div>
                              )}
                            </div>

                            <div className={`proof-dropzone-box ${formPaymentScreenshot ? 'has-file' : ''}`}>
                              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                                Payment Receipt Screenshot {formStatus === 'Completed' && <span style={{ color: 'var(--danger)' }}>*</span>}
                              </div>
                              {formPaymentScreenshot ? (
                                <div>
                                  <AttachmentImage
                                    value={formPaymentScreenshot}
                                    attachment={editingSale ? { type, saleId: editingSale.ID, kind: 'payment' } : null}
                                    alt="Payment Preview"
                                    className="proof-preview-thumb"
                                  />
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                    <button
                                      type="button"
                                      className="secondary"
                                      style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                                      onClick={() => setProofModal({ title: 'Payment Receipt Preview', url: formPaymentScreenshot, attachment: editingSale ? { type, saleId: editingSale.ID, kind: 'payment' } : null })}
                                    >
                                      Preview
                                    </button>
                                    {!isFinancialLocked && (
                                      <button
                                        type="button"
                                        className="danger"
                                        style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                                        onClick={() => setFormPaymentScreenshot('')}
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div style={{ fontSize: '1.4rem', color: '#94a3b8', marginBottom: '4px' }}>💳</div>
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    disabled={isFinancialLocked}
                                    onChange={(e) => handleFileUpload(e, 'payment')}
                                    style={{ fontSize: '0.78rem' }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Internal Notes Block */}
                        <div className="form-section-block">
                          <div className="form-section-header">
                            <div className="form-section-title">
                              <span className="title-text">📝 Internal Notes &amp; Delivery Instructions</span>
                            </div>
                            <div className="form-section-desc">Remarks, address, doctor prescriptions, constraints</div>
                          </div>
                          <textarea
                            rows={2}
                            disabled={isLocked}
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            placeholder="Add customer remarks, delivery preferences, dosage instructions…"
                          />
                        </div>
                      </div>
                    )}

                    {/* Step Navigation Footer (Unboxed) */}
                    <div className="stepper-footer" style={{ margin: '24px -32px -24px -32px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {activeStep === 1 ? (
                          <button type="button" className="secondary" onClick={() => setModalOpen(false)}>
                            Cancel
                          </button>
                        ) : (
                          <button type="button" className="secondary" onClick={handlePrevStep}>
                            &larr; Previous Step
                          </button>
                        )}
                        {editingSale && user.Role === 'admin' && (
                          <button
                            type="button"
                            className="danger"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.82rem' }}
                            onClick={() => openDeleteModal(editingSale)}
                            title="Delete this record (Admin only - requires reason)"
                          >
                            <span>🗑️</span> Delete Record
                          </button>
                        )}
                      </div>

                      <div className="stepper-footer-right">
                        <span style={{ fontSize: '0.78rem', color: '#64748b', marginRight: '6px' }}>
                          Step {activeStep} of 3
                        </span>

                        {activeStep < 3 ? (
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {activeStep === 2 && editingSale && !isMedpass && (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={handleSaveMedicationsOnly}
                                style={{
                                  background: '#16a34a',
                                  color: '#ffffff',
                                  fontWeight: 600,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '8px 16px',
                                  borderRadius: '8px',
                                  border: 'none',
                                  cursor: 'pointer',
                                }}
                              >
                                <span>💾</span> Save Medications
                              </button>
                            )}
                            <button type="button" onClick={handleNextStep}>
                              Next: {activeStep === 1 ? (isMedpass ? 'Plan Details' : 'Prescription') : 'Status & Payment'} &rarr;
                            </button>
                          </div>
                        ) : (
                          <button type="submit" disabled={saving}>
                            {saving ? 'Saving…' : editingSale ? 'Save Changes' : 'Create Record'}
                          </button>
                        )}
                      </div>
                    </div>
                  </form>
                )}

                {/* TAB 2: LOG CONTACT / INTERACTION (When editing - Unboxed) */}
                {editingSale && editMainTab === 'log_contact' && (
                  <div className="form-section-block" style={{ margin: 0, padding: 0, border: 'none' }}>
                    <div className="form-section-header" style={{ marginBottom: '18px' }}>
                      <div className="form-section-title">
                        <span className="title-text">📞 Log Interaction with {editingSale.CustomerName}</span>
                      </div>
                      <div className="form-section-desc">
                        Record calls, WhatsApp messages, customer callbacks and inquiries
                      </div>
                    </div>

                    {editingSale.DoNotCall && (
                      <div className="dnd-warning small-text" style={{ marginBottom: '12px' }}>
                        ⚠️ Customer is marked Do Not Call. Outgoing calls and WhatsApp messages are restricted.
                      </div>
                    )}

                    <form onSubmit={handleLogActivity}>
                      <div className="form-row three" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                        <div>
                          <label>Channel / Type</label>
                          <select value={actType} onChange={(e) => setActType(e.target.value as ActivityType)}>
                            <option value="Call">Call</option>
                            <option value="WhatsApp">WhatsApp</option>
                            <option value="Visit">Visit</option>
                            <option value="SMS">SMS</option>
                            <option value="Email">Email</option>
                            <option value="Note">Internal Note</option>
                          </select>
                        </div>

                        {actType !== 'Note' && (
                          <>
                            <div>
                              <label>Direction</label>
                              <select
                                value={actDirection}
                                onChange={(e) => {
                                  const dir = e.target.value as 'Outgoing' | 'Incoming';
                                  setActDirection(dir);
                                  if (dir === 'Incoming' && editingSale.Status === 'Cancelled') {
                                    setActStatusIntent('reopen');
                                  }
                                }}
                              >
                                {!editingSale.DoNotCall && <option value="Outgoing">Outgoing (We reached out)</option>}
                                <option value="Incoming">Incoming (Customer Reached Out)</option>
                              </select>
                            </div>

                            <div>
                              <label>Call / Contact Outcome</label>
                              <select
                                value={actOutcome}
                                onChange={(e) => {
                                  const out = e.target.value as ActivityOutcome;
                                  setActOutcome(out);
                                  if (out === 'Interested') {
                                    setActStatusIntent(editingSale.Status === 'Cancelled' ? 'reopen' : 'keep');
                                  }
                                }}
                              >
                                <option value="Connected">Connected</option>
                                <option value="Interested">Interested / Wants Service</option>
                                <option value="Call back later">Call back later</option>
                                <option value="No answer">No answer</option>
                                <option value="Not interested">Not interested</option>
                                <option value="Wrong number">Wrong number</option>
                              </select>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Customer Buying Interest / Callback Intent Option Box */}
                      {actType !== 'Note' && (actDirection === 'Incoming' || actOutcome === 'Interested') && (
                        <div className="customer-intent-box">
                          <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#166534', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>💡</span> Customer Callback / Buying Interest Detected
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#15803d', marginBottom: '8px' }}>
                            {editingSale.Status === 'Cancelled'
                              ? 'Customer reached back out or is interested in purchasing. Reopen this lead into active Pending status?'
                              : 'Customer expressed buying interest! Update status or progress to purchase?'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {editingSale.Status === 'Cancelled' && (
                              <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#14532d' }}>
                                <input
                                  type="radio"
                                  name="actIntent"
                                  checked={actStatusIntent === 'reopen'}
                                  onChange={() => setActStatusIntent('reopen')}
                                />
                                <strong>Reopen Lead to Pending with Hot Priority (Recommended)</strong>
                              </label>
                            )}
                            <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#14532d' }}>
                              <input
                                type="radio"
                                name="actIntent"
                                checked={actStatusIntent === 'complete'}
                                onChange={() => setActStatusIntent('complete')}
                              />
                              <span>Customer Wants to Buy Now (Proceed to payment details)</span>
                            </label>
                            <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#4b5563' }}>
                              <input
                                type="radio"
                                name="actIntent"
                                checked={actStatusIntent === 'keep'}
                                onChange={() => setActStatusIntent('keep')}
                              />
                              <span>Keep current status</span>
                            </label>
                          </div>
                        </div>
                      )}

                      <div style={{ marginBottom: '14px' }}>
                        <label>Conversation Notes &amp; Action Taken</label>
                        <textarea
                          rows={3}
                          value={actNotes}
                          onChange={(e) => setActNotes(e.target.value)}
                          placeholder={actType === 'Note' ? 'Add internal memo for the team…' : 'Details of customer conversation, pricing discussed, delivery request…'}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                          <label>Next Follow-up Date</label>
                          <input
                            type="date"
                            value={actNextFollowUp}
                            onChange={(e) => setActNextFollowUp(e.target.value)}
                          />
                        </div>
                        <button type="submit" style={{ height: '42px', padding: '0 20px' }}>
                          {actType === 'Note' ? 'Add Memo' : 'Log Interaction'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* TAB 3: HISTORY & AUDIT TRAIL (When editing) */}
                {editingSale && editMainTab === 'history' && (
                  <div>
                    {/* Sub-tabs for Audit vs Contact Activities vs All */}
                    <div className="history-nav-tabs">
                      <button
                        type="button"
                        className={`history-nav-btn ${historyTab === 'audits' ? 'active' : ''}`}
                        onClick={() => setHistoryTab('audits')}
                      >
                        📋 Lead History / Change Log ({auditHistory.length})
                      </button>
                      <button
                        type="button"
                        className={`history-nav-btn ${historyTab === 'activities' ? 'active' : ''}`}
                        onClick={() => setHistoryTab('activities')}
                      >
                        📞 Contact History ({activities.length})
                      </button>
                      <button
                        type="button"
                        className={`history-nav-btn ${historyTab === 'all' ? 'active' : ''}`}
                        onClick={() => setHistoryTab('all')}
                      >
                        🔄 All Timeline ({auditHistory.length + activities.length})
                      </button>
                    </div>

                    {/* Audits */}
                    {historyTab === 'audits' && (
                      <div>
                        {auditHistory.length === 0 ? (
                          <div className="muted small-text" style={{ padding: '20px', textAlign: 'center', background: '#fff', borderRadius: '8px' }}>
                            No modification history recorded yet.
                          </div>
                        ) : (
                          <div className="audit-list">
                            {auditHistory.map((audit) => {
                              const roleClass = (audit.ByRole || 'agent').toLowerCase();
                              const actionClass = audit.Action || 'update';
                              return (
                                <div key={audit.ID} className="audit-card">
                                  <div className="audit-header">
                                    <div className="audit-user-info">
                                      <span className="audit-avatar">{initials(audit.ByName)}</span>
                                      <span className="audit-user-name">{audit.ByName}</span>
                                      <span className={`role-badge ${roleClass}`}>{audit.ByRole || 'agent'}</span>
                                      <span className={`audit-action-badge ${actionClass}`}>
                                        {actionClass === 'reopen' && '🟢 Reopened'}
                                        {actionClass === 'create' && '🔵 Created'}
                                        {actionClass === 'complete' && '🟣 Completed'}
                                        {actionClass === 'cancel' && '🔴 Cancelled / Lost'}
                                        {actionClass === 'reassign' && '🟠 Reassigned'}
                                        {actionClass === 'status_change' && '🟣 Status Changed'}
                                        {actionClass === 'update' && '🟡 Updated'}
                                      </span>
                                    </div>
                                    <div className="audit-time" title={formatDateTime(audit.Date)}>
                                      {formatDateTime(audit.Date)} · {formatTimeAgo(audit.Date)}
                                    </div>
                                  </div>

                                  <div className="audit-summary">{audit.Summary}</div>

                                  {audit.Changes && audit.Changes.length > 0 && (
                                    <div className="audit-diff-grid">
                                      {audit.Changes.map((ch, idx) => (
                                        <div key={idx} className="audit-diff-row">
                                          <span className="diff-field-name">{ch.field}:</span>
                                          <span className="diff-from-val">{ch.from || '—'}</span>
                                          <span className="diff-arrow">➔</span>
                                          <span className="diff-to-val">{ch.to || '—'}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Contact Communication Activities */}
                    {historyTab === 'activities' && (
                      <div>
                        {activities.length === 0 ? (
                          <div className="muted small-text" style={{ padding: '20px', textAlign: 'center', background: '#fff', borderRadius: '8px' }}>
                            No contact interaction logged yet.
                          </div>
                        ) : (
                          <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                            <ul className="timeline">
                              {activities.map((act) => {
                                const isNote = act.Type === 'Note';
                                return (
                                  <li key={act.ID} className={`timeline-item type-${act.Type.toLowerCase()}`}>
                                    <div className="timeline-head">
                                      {isNote ? (
                                        <strong>Internal Memo</strong>
                                      ) : (
                                        <>
                                          <strong>{act.Type}</strong> ·{' '}
                                          <span>{act.Direction === 'Incoming' ? 'customer contacted us' : 'we contacted'}</span>{' '}
                                          · <span className="outcome" style={{ fontWeight: 600 }}>{act.Outcome}</span>
                                        </>
                                      )}
                                    </div>
                                    {act.Notes && <div className="timeline-notes">{act.Notes}</div>}
                                    <div className="timeline-meta">
                                      {formatDateTime(act.Date)} ({formatTimeAgo(act.Date)}) · {act.ByName}
                                      {act.NextFollowUp && ` · next follow up ${formatDate(act.NextFollowUp)}`}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* All Timeline */}
                    {historyTab === 'all' && (
                      <div>
                        {(() => {
                          const combined = [
                            ...activities.map((act) => ({
                              id: act.ID,
                              date: act.Date,
                              kind: 'activity' as const,
                              activity: act,
                            })),
                            ...auditHistory.map((aud) => ({
                              id: aud.ID,
                              date: aud.Date,
                              kind: 'audit' as const,
                              audit: aud,
                            })),
                          ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                          if (combined.length === 0) {
                            return (
                              <div className="muted small-text" style={{ padding: '20px', textAlign: 'center', background: '#fff', borderRadius: '8px' }}>
                                No history recorded yet.
                              </div>
                            );
                          }

                          return (
                            <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                              <ul className="timeline">
                                {combined.map((item) => {
                                  if (item.kind === 'activity') {
                                    const act = item.activity;
                                    const isNote = act.Type === 'Note';
                                    return (
                                      <li key={act.ID} className={`timeline-item type-${act.Type.toLowerCase()}`}>
                                        <div className="timeline-head">
                                          {isNote ? (
                                            <strong>Internal Memo</strong>
                                          ) : (
                                            <>
                                              <strong>{act.Type}</strong> ·{' '}
                                              <span>{act.Direction === 'Incoming' ? 'customer called' : 'we contacted'}</span>{' '}
                                              · <span className="outcome" style={{ fontWeight: 600 }}>{act.Outcome}</span>
                                            </>
                                          )}
                                        </div>
                                        {act.Notes && <div className="timeline-notes">{act.Notes}</div>}
                                        <div className="timeline-meta">
                                          {formatDateTime(act.Date)} ({formatTimeAgo(act.Date)}) · {act.ByName}
                                          {act.NextFollowUp && ` · next follow up ${formatDate(act.NextFollowUp)}`}
                                        </div>
                                      </li>
                                    );
                                  } else {
                                    const aud = item.audit;
                                    const roleClass = (aud.ByRole || 'agent').toLowerCase();
                                    return (
                                      <li key={aud.ID} className={`timeline-item type-${aud.Action === 'reopen' ? 'sale' : 'note'}`}>
                                        <div className="timeline-head" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                          <span className={`audit-action-badge ${aud.Action}`}>
                                            {aud.Action === 'reopen' && '🟢 Reopened'}
                                            {aud.Action === 'create' && '🔵 Created'}
                                            {aud.Action === 'complete' && '🟣 Completed'}
                                            {aud.Action === 'cancel' && '🔴 Cancelled / Lost'}
                                            {aud.Action === 'reassign' && '🟠 Reassigned'}
                                            {aud.Action === 'status_change' && '🟣 Status Changed'}
                                            {aud.Action === 'update' && '🟡 Updated'}
                                          </span>
                                          <strong>{aud.ByName}</strong>
                                          <span className={`role-badge ${roleClass}`}>{aud.ByRole || 'agent'}</span>
                                        </div>
                                        <div className="timeline-notes" style={{ fontWeight: 500 }}>{aud.Summary}</div>
                                        {aud.Changes && aud.Changes.length > 0 && (
                                          <div style={{ marginTop: '4px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                            {aud.Changes.map((ch, idx) => (
                                              <span key={idx} style={{ marginRight: '8px' }}>
                                                {ch.field}: <span style={{ textDecoration: 'line-through', color: '#991b1b' }}>{ch.from}</span> → <strong style={{ color: '#166534' }}>{ch.to}</strong>
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        <div className="timeline-meta">
                                          {formatDateTime(aud.Date)} ({formatTimeAgo(aud.Date)})
                                        </div>
                                      </li>
                                    );
                                  }
                                })}
                              </ul>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Admin Delete Confirmation Modal with required reason */}
        {deleteModalSale && (
          <>
            <div className="overlay open" style={{ zIndex: 1200 }} onClick={closeDeleteModal} />
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
                maxWidth: '520px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
                zIndex: 1201,
                overflow: 'hidden',
                border: '1px solid #fecaca',
              }}
            >
              <div style={{ background: '#fef2f2', padding: '18px 24px', borderBottom: '1px solid #fee2e2', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0 }}>
                  ⚠️
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.08rem', color: '#991b1b', fontWeight: 700 }}>
                    Delete Sale Record
                  </h3>
                  <span style={{ fontSize: '0.78rem', color: '#b91c1c' }}>
                    Administrator Authorization Required · Reason Mandatory
                  </span>
                </div>
              </div>

              <div style={{ padding: '20px 24px' }}>
                {/* Record Summary Card */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>
                      {deleteModalSale.CustomerName}
                    </span>
                    <span style={{ fontWeight: 700, color: '#16a34a', fontSize: '0.95rem' }}>
                      {deleteModalSale.Amount ? formatMoney(deleteModalSale.Amount) : '—'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    <span>📞 {deleteModalSale.Contact || 'No phone'}</span>
                    <span>📅 {formatDate(deleteModalSale.Date)}</span>
                    <span>👤 Agent: {deleteModalSale.AgentName}</span>
                    <span>🔖 Status: {deleteModalSale.Status}</span>
                  </div>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    Reason for deletion <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <textarea
                    value={deleteReason}
                    onChange={(e) => {
                      setDeleteReason(e.target.value);
                      if (deleteError) setDeleteError(null);
                    }}
                    placeholder="Write a clear reason for deleting this record (e.g. Duplicated lead, Customer requested cancellation, Test entry)..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: deleteError ? '1px solid #ef4444' : '1px solid #cbd5e1',
                      fontSize: '0.85rem',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      fontFamily: 'inherit',
                    }}
                    autoFocus
                  />
                  {deleteError && (
                    <div style={{ fontSize: '0.78rem', color: '#dc2626', marginTop: '4px', fontWeight: 500 }}>
                      {deleteError}
                    </div>
                  )}
                </div>

                {/* Quick suggestions */}
                <div style={{ marginBottom: '16px' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                    Quick suggestions:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {[
                      'Duplicate entry in CRM',
                      'Customer requested cancellation',
                      'Test data / accidental submission',
                      'Invalid customer details / Fake inquiry',
                    ].map((sugg) => (
                      <button
                        key={sugg}
                        type="button"
                        onClick={() => {
                          setDeleteReason(sugg);
                          if (deleteError) setDeleteError(null);
                        }}
                        style={{
                          background: deleteReason === sugg ? '#fee2e2' : '#f1f5f9',
                          color: deleteReason === sugg ? '#991b1b' : '#475569',
                          border: deleteReason === sugg ? '1px solid #fca5a5' : '1px solid #e2e8f0',
                          borderRadius: '6px',
                          padding: '4px 9px',
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                          fontWeight: deleteReason === sugg ? 600 : 400,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        + {sugg}
                      </button>
                    ))}
                  </div>
                </div>

                <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
                  ℹ️ This action is permanent. The record will be removed and your reason will be logged in the permanent audit trail under Administrator {user.Name}.
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={closeDeleteModal}
                  disabled={isDeleting}
                  style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting || !deleteReason.trim()}
                  style={{
                    padding: '8px 18px',
                    fontSize: '0.85rem',
                    background: !deleteReason.trim() ? '#fca5a5' : '#dc2626',
                    cursor: !deleteReason.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {isDeleting ? 'Deleting…' : 'Confirm & Delete'}
                </button>
              </div>
            </div>
          </>
        )}

        {importOpen && (
          <Suspense fallback={<div className="overlay open" />}>
          <ImportModal
            type={type}
            user={user}
            agents={agentRoster}
            onClose={() => setImportOpen(false)}
            onImported={() => {
              setImportOpen(false);
              loadData();
            }}
            onToast={onToast}
          />
          </Suspense>
        )}

        {/* Proof modal for preview */}
        {proofModal && (
          <ProofModal title={proofModal.title} imageUrl={proofModal.url} attachment={proofModal.attachment} onClose={() => setProofModal(null)} />
        )}
      </main>
    </div>
  );
};
