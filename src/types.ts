export type UserRole = 'agent' | 'manager' | 'admin';

export interface User {
  ID: string;
  Name: string;
  Email: string;
  Role: UserRole;
  MedpassFullRate: number;
  MedpassDiscountRate: number;
  PharmacyIncentivePercent: number;
  Active: boolean;
  CreatedAt: string;
  MustChangePassword?: boolean;
}

export type SaleType = 'medpass' | 'pharmacy';
export type SaleStatus = 'Pending' | 'Completed' | 'Cancelled';
export type PriceType = 'Full Price' | 'Discounted' | 'Converted From OP' | '';
export type LeadTemperature = 'Hot' | 'Warm' | 'Cold';
export type LeadDirection = 'Inbound' | 'Outbound';

export type MedicineForm =
  | 'tablet'
  | 'syrup'
  | 'inhaler'
  | 'drops'
  | 'cream'
  | 'injection'
  | 'sachet'
  | 'course';

export interface ProductLine {
  name: string;
  quantity: number;
  frequency: 'Once a day' | 'Twice a day' | 'Thrice a day';
  unitsPerDose: number;
  formType?: MedicineForm;
  unitName?: string;
  bottleVolume?: number;
  bottlesCount?: number;
  customDays?: number;
  daysSupply?: number;
  expiryDate?: string;
  daysRemaining?: number;
  overdue?: boolean;
}

export type ActivityType = 'Call' | 'WhatsApp' | 'Visit' | 'SMS' | 'Email' | 'Note';
export type ActivityDirection = 'Outgoing' | 'Incoming' | '';
export type ActivityOutcome =
  | 'Connected'
  | 'No answer'
  | 'Call back later'
  | 'Interested'
  | 'Not interested'
  | 'Wrong number'
  | '';

export interface SaleActivity {
  ID: string;
  SaleID: string;
  Date: string;
  ByEmail: string;
  ByName: string;
  Type: ActivityType;
  Direction: ActivityDirection;
  Outcome: ActivityOutcome;
  Notes: string;
  NextFollowUp: string;
}

export interface AuditChange {
  field: string;
  from: string;
  to: string;
}

export interface AuditEntry {
  ID: string;
  SaleID: string;
  RecordID?: string;
  RecordType?: string;
  Date: string;
  ByEmail: string;
  ByName: string;
  ByRole?: string;
  Action: 'create' | 'update' | 'reassign' | 'reopen' | 'status_change' | 'complete' | 'cancel' | 'callback' | 'delete';
  Summary: string;
  Changes?: AuditChange[];
}

export interface Sale {
  ID: string;
  Date: string; // YYYY-MM-DD
  AgentEmail: string;
  AgentName: string;
  CustomerName: string;
  Contact: string;
  ContactKey?: string;
  Detail: string;
  Products: string; // JSON string of ProductLine[]
  Amount: number;
  Status: SaleStatus;
  PriceType: PriceType;
  PaymentMethod: string;
  UTR: string;
  BillScreenshotUrl: string;
  PaymentScreenshotUrl: string;
  Notes: string;
  CreatedAt: string;

  // Integrated Lead & Follow-up Attributes
  Temperature?: LeadTemperature;
  Direction?: LeadDirection;
  Channel?: string;
  HeardFrom?: string;
  Consent?: boolean;
  DoNotCall?: boolean;
  LostReason?: string;
  NextFollowUp?: string;
  FollowUpStatus?: 'overdue' | 'today' | 'upcoming' | '';
  AttemptCount?: number;
}

export interface Reminder {
  ID: string;
  PharmacySaleID: string;
  AgentEmail: string;
  AgentName: string;
  Reassigned: boolean;
  CustomerName: string;
  Contact: string;
  Products: ProductLine[];
  DaysRemaining: number | null;
  Overdue: boolean;
  Status: 'Active' | 'Resolved';
  ResolutionReason: string;
  AttemptCount: number;
  NeedsAttention: boolean;
  LastAttemptDate: string;
  CreatedAt: string;
  SaleDate?: string;
}

export interface OptionLists {
  channels: string[];
  heardFrom: string[];
  lostReasons: string[];
  temperatures: string[];
  directions: string[];
  activityTypes: string[];
  activityDirections: string[];
  outcomes: string[];
}

export interface DashboardAgent {
  agentName: string;
  agentEmail: string;
  medpassCount: number;
  pharmacyCount: number;
  medpassAmount: number;
  pharmacyAmount: number;
  incentive?: number;
}

export interface PipelineMetrics {
  completed: number;
  pending: number;
  cancelled: number;
  totalLeads: number;
  conversionRate: number;
}

export interface TopMedicationItem {
  name: string;
  prescriptions: number;
  totalUnits: number;
}

export interface PaymentMethodBreakdown {
  method: string;
  count: number;
  amount: number;
}

export interface UrgentFollowUpItem {
  id: string;
  type: SaleType;
  customerName: string;
  contact: string;
  detail: string;
  temperature: string;
  amount: number;
  agentName: string;
  nextFollowUp?: string;
  followUpStatus?: 'overdue' | 'today' | 'upcoming';
  notes?: string;
}

export interface DashboardSummary {
  totals: {
    medpassCount: number;
    pharmacyCount: number;
    medpassAmount: number;
    pharmacyAmount: number;
  };
  agents: DashboardAgent[];
  pipeline: PipelineMetrics;
  topMedications: TopMedicationItem[];
  paymentBreakdown: PaymentMethodBreakdown[];
  recentAudits?: AuditEntry[];
  recentActivities?: SaleActivity[];
  urgentFollowUps?: UrgentFollowUpItem[];
  monthlyTarget?: {
    targetAmount: number;
    currentAmount: number;
    percentage: number;
  };
}

export interface ToastMessage {
  id: string;
  text: string;
  type: 'error' | 'success';
}
