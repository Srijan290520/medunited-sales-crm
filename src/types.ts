export type UserRole = 'agent' | 'manager' | 'senior_manager' | 'admin';

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

export type SaleType = 'medpass' | 'pharmacy' | 'homekare' | 'lab';

// A module as the server describes it (getModules).
export interface ModuleInfo {
  id: SaleType;
  label: string;
  priceTypes: boolean;
  products: boolean;
  reminders: boolean;
  lineItems: boolean;
  incentive: 'perSale' | 'percent' | 'none';
  services?: HomekareService[]; // Homekare catalogue
  testKinds?: string[]; // Lab & Radiology
  reportVia?: string[];
}

export interface HomekareService {
  name: string;
  unit: string;
  monthly: boolean;
  hidden?: boolean; // not offered for new orders; still valid on older ones
  builtIn?: boolean;
}

export interface ServiceLine {
  service: string;
  price: number;
}

export interface TestLine {
  name: string;
  kind: 'Lab' | 'Radiology';
  price: number;
}
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

  // Patient (one owner agent per patient; relatives on one number = a household)
  PatientID?: string;
  AlsoIn?: string[]; // other modules where this patient has records
  HouseholdSize?: number; // people sharing this phone number

  // Medpass only (worked out by the server, see apps-script/Medpass.gs)
  Members?: MedpassMember[];
  ListPrice?: number | null; // null on records from before the Medpass rules
  ExtraChildFee?: number;
  DiscountAmount?: number;
  DiscountReason?: string;
  DiscountStatus?: '' | 'Requested' | 'Approved' | 'Rejected';
  DiscountRequestedBy?: string;
  DiscountDecidedBy?: string;
  OPCredit?: number; // OP consultation fee already paid, credited on a Converted From OP pass
  PayableNow?: number; // what the customer pays today
  ValidFrom?: string;
  ValidUntil?: string;
  PassStatus?: '' | 'active' | 'expired';

  // Homekare
  Services?: ServiceLine[];
  MonthlyPackage?: boolean;

  // Lab & Radiology
  Tests?: TestLine[];
  HomeCollection?: boolean;
  CollectionDate?: string;
  AppointmentDate?: string;
  ReportDeliveredOn?: string;
  ReportDeliveredVia?: string;
}

export type MedpassRelation = 'Father' | 'Mother' | 'Child';

export interface MedpassMember {
  name: string;
  relation: MedpassRelation;
  dob: string; // YYYY-MM-DD; required for children
}

export interface MedpassSettings {
  price: number;
  maxDiscount: number;
  extraChildFee: number;
  includedChildren: number;
  maxExtraChildren: number;
  childMaxAge: number;
  singleParent: boolean;
}

export interface PendingDiscount {
  ID: string;
  CustomerName: string;
  AgentName: string;
  DiscountAmount: number;
  DiscountReason: string;
  DiscountRequestedBy: string;
  Amount: number;
  UpdatedAt: string;
}

// A person on a phone number, as returned by checkContact. Only the owner of
// the number and managers/admins get these.
export interface ContactPerson {
  ID: string; // '' for people known only from older records — send the name instead
  Name: string;
  OwnerName: string;
  OwnerEmail: string;
  Mine: boolean;
  Conflict: boolean;
  OpenModules: string[];
}

export interface ContactCheck {
  activeSales: { ID: string; CustomerName: string; AgentName: string; Module: string; Mine: boolean }[];
  pastCompletedCount: number;
  owner: { name: string; email: string; isMe: boolean } | null;
  owners: { name: string; email: string }[];
  people: ContactPerson[];
  othersCount: number;
  conflict: boolean;
}

export interface PatientConflict {
  contactKey: string;
  contact: string;
  agents: { email: string; name: string; open: number; closed: number }[];
  people: {
    ID: string;
    Name: string;
    Conflict: boolean;
    OwnerName: string;
    records: { module: string; status: string; agentName: string; date: string }[];
  }[];
}

export interface MigrationSummary {
  dryRun: boolean;
  households: number;
  patientsCreated: number;
  recordsLinked: number;
  newConflicts: number;
  conflicts: PatientConflict[];
}

export interface UserRequest {
  ID: string;
  Type: 'deactivate';
  UserEmail: string;
  UserName: string;
  SuccessorEmail: string;
  SuccessorName: string;
  Reason: string;
  RequestedByName: string;
  Status: 'Pending' | 'Approved' | 'Rejected';
  DecidedByName: string;
  DecisionNote: string;
  CreatedAt: string;
  DecidedAt: string;
}

export interface Reminder {
  ID: string;
  Kind: 'refill' | 'renewal'; // Pharmacy refill, or a monthly Homekare package ending
  SaleType: SaleType;
  SaleID: string;
  Detail: string; // renewal: the monthly services
  EndDate: string; // renewal: last day of the package
  DueDate: string; // renewal: when the reminder becomes due
  IsDue: boolean;
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
    homekareCount?: number;
    homekareAmount?: number;
    labCount?: number;
    labAmount?: number;
  };
  agents: DashboardAgent[];
  pipeline: PipelineMetrics;
  topMedications: TopMedicationItem[];
  paymentBreakdown: PaymentMethodBreakdown[];
  recentAudits?: AuditEntry[];
  recentActivities?: SaleActivity[];
  urgentFollowUps?: UrgentFollowUpItem[];
  // Phase 4 widgets (always filtered by role on the server)
  temperature?: { Hot: number; Warm: number; Cold: number };
  modules?: { id: SaleType; label: string; count: number; amount: number }[];
  remindersDue?: { id: string; kind: 'refill' | 'renewal'; customerName: string; detail: string; daysRemaining: number | null; overdue: boolean; agentName: string }[];
  pendingDiscounts?: PendingDiscount[] | null; // team only
  myTargets?: TargetRow[] | null; // agents: their own targets this month
  comparison?: { thisMonth: { count: number; amount: number }; lastMonth: { count: number; amount: number } };

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

// Dashboard layout: widgets on a 12-column grid.
export type WidgetId = 'target' | 'comparison' | 'followups' | 'reminders' | 'temperature' | 'modules' | 'pipeline' | 'activity' | 'discounts' | 'team';
export interface LayoutItem {
  id: WidgetId;
  span: 4 | 6 | 8 | 12;
}
export interface DashboardLayoutInfo {
  layout: LayoutItem[];
  source: 'user' | 'role';
  widgets: { id: WidgetId; title: string }[]; // what this role may add
  spans: number[];
}

// Monthly target for one agent and module.
export interface TargetRow {
  agentEmail: string;
  agentName: string;
  module: SaleType;
  moduleLabel: string;
  measure: 'revenue' | 'count';
  target: number | null;
  achieved: number;
  percent: number | null;
}

export interface IncentiveSale {
  id: string;
  module: SaleType;
  moduleLabel: string;
  date: string;
  customerName: string;
  amount: number;
  priceType: string;
  detail: string;
  incentive: number;
}

export interface IncentiveAgent {
  agentEmail: string;
  agentName: string;
  modules: Record<string, { count: number; amount: number; incentive: number }>;
  count: number;
  amount: number;
  incentive: number;
  sales: IncentiveSale[];
}

export interface IncentiveReport {
  month: string;
  modules: { id: SaleType; label: string; incentive: string }[];
  agents: IncentiveAgent[];
  totals: { count: number; amount: number; incentive: number; modules: Record<string, { count: number; amount: number; incentive: number }> };
}

// ===== Patients page (apps-script/PatientProfiles.gs) =====
export interface PatientModuleCount {
  type: SaleType;
  label: string;
  open: number;
  completed: number;
  lost: number;
}

export interface PatientSummary {
  ID: string;
  Name: string;
  Contact: string;
  ContactKey: string;
  DOB: string;
  AltContact: string;
  Address: string;
  Area: string;
  Pincode: string;
  Notes: string;
  OwnerName: string;
  OwnerEmail: string;
  Conflict: boolean;
  Mine: boolean;
  CanEdit: boolean; // owner, managers and admins
  DoNotCall: boolean;
  HouseholdSize: number;
  Modules: PatientModuleCount[];
  OpenCount: number;
  NextFollowUp: string; // earliest of the patient's own and their open records'
  FollowUpStatus: 'overdue' | 'today' | 'upcoming' | '';
  OwnFollowUp: string;
  LastContact: string;
  CreatedAt: string;
}

export interface PatientRecord extends Sale {
  Type: SaleType;
  ModuleLabel: string;
  CanOpen: boolean; // false: another agent's record, shown read-only
}

export interface PatientActivity extends SaleActivity {
  SaleType: SaleType | 'patient';
  About: string; // 'General' or the record it was logged on
}

export interface PatientDetail {
  patient: PatientSummary;
  records: PatientRecord[];
  activities: PatientActivity[];
  reminders: Reminder[];
  household: { ID: string; Name: string; OwnerName: string; Conflict: boolean }[];
}
