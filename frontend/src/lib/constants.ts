import { SuggestionCard } from './types';

export type IndustryType = 'telco' | 'government' | 'fsi';

export const INDUSTRY_OPTIONS = [
  { value: 'telco' as const, label: 'Telco' },
  { value: 'government' as const, label: 'Government' },
  { value: 'fsi' as const, label: 'FSI' }
];

// Telco Cards
export const TELCO_SUGGESTION_CARDS: SuggestionCard[] = [
  {
    id: 'billing-issue',
    title: 'My bill looks wrong',
    subtitle: 'Review recent charges',
    icon: 'Receipt',
    prompt: 'Please review my last bills and explain any increases.',
    toolName: 'get_billing_info'
  },
  {
    id: 'account-balance',
    title: "What's my balance?",
    subtitle: 'Balance & data usage',
    icon: 'CreditCard',
    prompt: "What's my current balance and data left?",
    toolName: 'get_account_balance'
  },
  {
    id: 'service-outage',
    title: 'Area outage?',
    subtitle: 'Check outages near me',
    icon: 'Warning',
    prompt: 'Is there an outage in my area?',
    toolName: 'check_service_outage'
  },
  {
    id: 'slow-internet',
    title: 'Internet is slow',
    subtitle: 'Run diagnostics',
    icon: 'WifiX',
    prompt: 'My internet is slow, please run diagnostics.',
    toolName: 'check_network_connectivity'
  },
  {
    id: 'pay-bill',
    title: 'Pay my bill',
    subtitle: 'Process a payment',
    icon: 'Money',
    prompt: 'I want to pay my bill.',
    toolName: 'process_payment'
  },
  {
    id: 'change-plan',
    title: 'Change my plan',
    subtitle: 'Upgrade or downgrade',
    icon: 'ArrowsUpDown',
    prompt: 'Please recommend and switch me to a better plan.',
    toolName: 'modify_plan'
  },
  {
    id: 'enable-roaming',
    title: 'Enable roaming',
    subtitle: 'Travel support',
    icon: 'Globe',
    prompt: 'Enable roaming for Spain from tomorrow to next week.',
    toolName: 'manage_roaming'
  },
  {
    id: 'sim-support',
    title: 'Replace SIM / PUK',
    subtitle: 'SIM help',
    icon: 'SimCard',
    prompt: 'I need my PUK code and to activate a replacement SIM.',
    toolName: 'manage_sim'
  },
  {
    id: 'device-troubleshoot',
    title: 'Troubleshoot device',
    subtitle: 'Phone/router help',
    icon: 'Router',
    prompt: 'My router keeps disconnecting.',
    toolName: 'device_support'
  },
  {
    id: 'cancel-service',
    title: 'Cancel service',
    subtitle: 'Close or port out',
    icon: 'XCircle',
    prompt: 'I want to cancel my service at end of cycle.',
    toolName: 'cancel_service'
  },
  {
    id: 'general-info',
    title: 'Coverage & Promotions',
    subtitle: 'Get general information',
    icon: 'Info',
    prompt: 'What promotions do you have available?',
    toolName: 'general_info'
  },
  {
    id: 'value-added',
    title: 'Add/Remove Features',
    subtitle: 'Manage add-on services',
    icon: 'Plus',
    prompt: 'What features can I add to my plan?',
    toolName: 'manage_value_added'
  },  
  {
    id: 'update-info',
    title: 'Update Account Info',
    subtitle: 'Change contact details',
    icon: 'User',
    prompt: 'I need to update my contact information.',
    toolName: 'update_account_info'
  },
  {
    id: 'installation',
    title: 'Schedule Installation',
    subtitle: 'New service setup',
    icon: 'Calendar',
    prompt: 'I need to schedule a technician visit.',
    toolName: 'schedule_installation'
  },
  {
    id: 'lost-stolen',
    title: 'Lost/Stolen Device',
    subtitle: 'Suspend or blacklist',
    icon: 'ShieldWarning',
    prompt: 'My phone was stolen and I need to suspend service.',
    toolName: 'report_lost_stolen'
  }
];

// Government Cards
export const GOVERNMENT_SUGGESTION_CARDS: SuggestionCard[] = [
  {
    id: 'renew-national-id',
    title: 'Renew National ID',
    subtitle: 'ID renewal or replacement',
    icon: 'IdentificationCard',
    prompt: 'I need to renew my national ID card.',
    toolName: 'renew_national_id'
  },
  {
    id: 'passport-request',
    title: 'Passport Services',
    subtitle: 'Issuance or renewal',
    icon: 'BookOpen',
    prompt: 'I need help with my passport application.',
    toolName: 'process_passport_request'
  },
  {
    id: 'residency-permit',
    title: 'Residency Permit',
    subtitle: 'Visa & permit services',
    icon: 'MapPin',
    prompt: 'I need to renew my residency permit.',
    toolName: 'manage_residency_permit'
  },
  {
    id: 'drivers-license',
    title: 'Driver License',
    subtitle: 'Applications & renewals',
    icon: 'Car',
    prompt: 'I need to renew my driver license.',
    toolName: 'handle_drivers_license'
  },
  {
    id: 'vehicle-registration',
    title: 'Vehicle Registration',
    subtitle: 'Registration renewals',
    icon: 'FileText',
    prompt: 'I need to renew my vehicle registration.',
    toolName: 'manage_vehicle_registration'
  },
  {
    id: 'traffic-fines',
    title: 'Traffic Fines',
    subtitle: 'Violations & payments',
    icon: 'Warning',
    prompt: 'I want to check my traffic fines.',
    toolName: 'inquire_traffic_fines'
  },
  {
    id: 'utility-account',
    title: 'Utility Services',
    subtitle: 'Electricity & water billing',
    icon: 'Lightbulb',
    prompt: 'I have a question about my electricity bill.',
    toolName: 'manage_utility_account'
  },
  {
    id: 'health-services',
    title: 'Health Services',
    subtitle: 'Health card & appointments',
    icon: 'Heart',
    prompt: 'I need to renew my health card.',
    toolName: 'schedule_health_services'
  },
  {
    id: 'official-documents',
    title: 'Official Documents',
    subtitle: 'Civil documents & attestations',
    icon: 'Certificate',
    prompt: 'I need a birth certificate.',
    toolName: 'request_official_documents'
  },
  {
    id: 'social-welfare',
    title: 'Social Welfare',
    subtitle: 'Benefits & pension programs',
    icon: 'Users',
    prompt: 'I have questions about my pension benefits.',
    toolName: 'social_welfare_inquiry'
  },
  {
    id: 'housing-services',
    title: 'Housing Services',
    subtitle: 'Housing & land applications',
    icon: 'House',
    prompt: 'I want to check my housing application status.',
    toolName: 'housing_service_request'
  },
  {
    id: 'employment-labor',
    title: 'Employment & Labor',
    subtitle: 'Work permits & complaints',
    icon: 'Briefcase',
    prompt: 'I need help with my work permit.',
    toolName: 'employment_labor_support'
  },
  {
    id: 'police-clearance',
    title: 'Police Clearance',
    subtitle: 'Good conduct certificates',
    icon: 'Shield',
    prompt: 'I need a police clearance certificate.',
    toolName: 'issue_police_clearance'
  },
  {
    id: 'report-incident',
    title: 'Report Incident',
    subtitle: 'File incident reports',
    icon: 'WarningCircle',
    prompt: 'I need to report an incident.',
    toolName: 'report_incident'
  },
  {
    id: 'public-feedback',
    title: 'Public Feedback',
    subtitle: 'Complaints & suggestions',
    icon: 'ChatCircle',
    prompt: 'I want to submit feedback about government services.',
    toolName: 'submit_public_feedback'
  }
];

// FSI Cards
export const FSI_SUGGESTION_CARDS: SuggestionCard[] = [
  {
    id: 'digital-access-issue',
    title: 'Digital Access Help',
    subtitle: 'Online & mobile banking',
    icon: 'DeviceMobile',
    prompt: 'I cannot access my online banking account.',
    toolName: 'handle_digital_access_issue'
  },
  {
    id: 'account-activity',
    title: 'Account Activity',
    subtitle: 'Balance & transactions',
    icon: 'List',
    prompt: 'Please show my account balance and recent transactions.',
    toolName: 'inquiry_account_activity'
  },
  {
    id: 'fund-transfer',
    title: 'Fund Transfers',
    subtitle: 'Payments & transfers',
    icon: 'ArrowsLeftRight',
    prompt: 'I need help with a fund transfer.',
    toolName: 'support_fund_transfer'
  },
  {
    id: 'card-loss',
    title: 'Lost Card',
    subtitle: 'Block & replace card',
    icon: 'CreditCard',
    prompt: 'My card is lost and I need to block it.',
    toolName: 'report_card_loss'
  },
  {
    id: 'card-status-issue',
    title: 'Card Issues',
    subtitle: 'Declines & activation',
    icon: 'Warning',
    prompt: 'My card was declined at the merchant.',
    toolName: 'resolve_card_status_issue'
  },
  {
    id: 'fraud-alert',
    title: 'Fraud Alert',
    subtitle: 'Security & fraud',
    icon: 'ShieldWarning',
    prompt: 'I received a fraud alert on my account.',
    toolName: 'handle_fraud_alert'
  },
  {
    id: 'dispute-transaction',
    title: 'Dispute Transaction',
    subtitle: 'Chargebacks & disputes',
    icon: 'XCircle',
    prompt: 'I need to dispute a transaction on my statement.',
    toolName: 'dispute_transaction'
  },
  {
    id: 'fees-inquiry',
    title: 'Service Fees',
    subtitle: 'Fees & waivers',
    icon: 'Receipt',
    prompt: 'I have questions about the fees on my account.',
    toolName: 'inquire_fees'
  },
  {
    id: 'loan-mortgage',
    title: 'Loan Services',
    subtitle: 'Mortgage & loan help',
    icon: 'House',
    prompt: 'I need assistance with my loan account.',
    toolName: 'loan_mortgage_assistance'
  },
  {
    id: 'funds-availability',
    title: 'Fund Availability',
    subtitle: 'Deposit issues',
    icon: 'Clock',
    prompt: 'When will my deposit be available?',
    toolName: 'resolve_funds_availability'
  },
  {
    id: 'account-maintenance',
    title: 'Update Account',
    subtitle: 'Account changes',
    icon: 'User',
    prompt: 'I need to update my account information.',
    toolName: 'update_account_maintenance'
  },
  {
    id: 'new-products',
    title: 'New Products',
    subtitle: 'Banking products',
    icon: 'Plus',
    prompt: 'What new banking products do you offer?',
    toolName: 'explore_new_products'
  },
  {
    id: 'complaint',
    title: 'File Complaint',
    subtitle: 'Service complaints',
    icon: 'ChatCircle',
    prompt: 'I want to file a complaint about the service.',
    toolName: 'escalate_complaint'
  },
  {
    id: 'merchant-services',
    title: 'Merchant Services',
    subtitle: 'Business payments',
    icon: 'Briefcase',
    prompt: 'I need help with merchant payment processing.',
    toolName: 'merchant_services_support'
  },
  {
    id: 'corporate-platform',
    title: 'Corporate Banking',
    subtitle: 'Business platform',
    icon: 'Buildings',
    prompt: 'I have an issue with the corporate banking platform.',
    toolName: 'corporate_platform_support'
  }
];

export const INDUSTRY_CARD_MAP = {
  telco: TELCO_SUGGESTION_CARDS,
  government: GOVERNMENT_SUGGESTION_CARDS,
  fsi: FSI_SUGGESTION_CARDS
};

// Default to telco for backward compatibility
export const DEFAULT_SUGGESTION_CARDS = TELCO_SUGGESTION_CARDS;

const runtimeConfig = typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined;
const runtimeBackendBaseUrl = runtimeConfig?.backendBaseUrl;

export const CLIENT_CONFIG = {
  backendBaseUrl: runtimeBackendBaseUrl ?? import.meta.env.VITE_BACKEND_BASE_URL ?? "http://localhost:8080/api",
  deployment: "gpt-realtime",
  voice: "verse",
};

// Voice and model selections loaded from backend runtime config
const runtimeVoiceSelections = (window as any).__APP_CONFIG__?.voiceSelections;
const runtimeModelSelections = (window as any).__APP_CONFIG__?.modelSelections;

export const GPT_REALTIME_VOICES = runtimeVoiceSelections?.gptRealtime ?? [];
export const VOICE_LIVE_VOICES = runtimeVoiceSelections?.voiceLive ?? [];
export const GPT_REALTIME_MODELS = runtimeModelSelections?.gptRealtime ?? [];
export const VOICE_LIVE_MODELS = runtimeModelSelections?.voiceLive ?? [];

export const SYSTEM_PROMPT = `## Role & Objective

You are **Contoso Unified Service Agent**, a friendly, fast, and knowledgeable customer-service representative supporting **telecom**, **government services**, and **financial services (FSI)** callers.
**Goal:** Quickly understand the caller’s industry context, retrieve accurate information or take action using available tools, and leave the customer feeling heard and satisfied.

---

## Personality & Tone

* **Personality:** Warm, upbeat, empathetic, professional.
* **Tone:** Friendly and concise. Never robotic or overly formal.
* **Length:** 2–3 sentences per turn.
* **Pacing:** Speak at a natural but brisk pace. Respond promptly after the user finishes speaking.

---

## Language

* Mirror the caller’s language if intelligible.
* If the language is unclear, politely default to English.
* Stay in a single language per call.
* Preferred languages for this region are Arabic and English.

---

## Conversation Flow

**Greeting → Discover → Verify → Diagnose/Resolve → Confirm/Close**

### Greeting

* Welcome the caller, confirm whether they need telecom, government, or banking support, and invite their issue.
* Sample phrases (vary):
  * "Hi, thanks for calling Contoso. Are you calling about telecom, government services, or banking today?"
  * "Welcome to Contoso Support. Which service can I help you with right now?"

### Discover

* Listen carefully, clarify the request, and restate the issue to confirm understanding.

### Verify

* Gather any identifiers needed for the relevant industry (e.g., account ID, national ID, card last four digits) before calling tools.

### Diagnose / Resolve

* Use appropriate tools (see **Tools** section).
* Give short status updates while working.
* Confirm important actions before executing them.

### Confirm / Close

* Summarize what was done, outline next steps, and ask if anything else is needed.
* Close with a friendly goodbye.

---

## Tools

When a tool call is needed, always preface with a short phrase like "I’m checking that now." Call the exact tool name.

**Telecom**
* 'get_billing_info' – Retrieve recent bills, charges, or disputes.
* 'check_network_connectivity' – Test or report connectivity issues.
* 'check_service_outage' – Look up area-wide outages.
* 'get_account_balance' – Provide balance or data usage.
* 'modify_plan' – Change or upgrade/downgrade plans.
* 'manage_sim' – Activate/replace SIM, provide PUK.
* 'process_payment' – Take or confirm payments/recharges.
* 'device_support' – Troubleshoot phones, routers, or modems.
* 'schedule_installation' – New service setup or appointments.
* 'manage_roaming' – Enable/disable roaming, troubleshoot abroad.
* 'manage_value_added' – Add/remove optional services/features.
* 'update_account_info' – Change contact details or reset password.
* 'report_lost_stolen' – Suspend/blacklist lost or stolen devices.
* 'cancel_service' – Terminate or port service.
* 'general_info' – Provide coverage details, promotions, FAQs.

**Government Services**
* 'renew_national_id' – Assist with national ID renewal or replacement requests.
* 'process_passport_request' – Handle passport issuance or renewal inquiries.
* 'manage_residency_permit' – Support visa and residency permit services.
* 'handle_drivers_license' – Provide guidance on driver license applications or renewals.
* 'manage_vehicle_registration' – Manage vehicle registration renewals and status checks.
* 'inquire_traffic_fines' – Summarize outstanding traffic violations and payment deadlines.
* 'manage_utility_account' – Handle electricity or water billing inquiries.
* 'schedule_health_services' – Assist with health card renewals or appointments.
* 'request_official_documents' – Track civil document issuance and attestations.
* 'social_welfare_inquiry' – Answer questions on social welfare and pension programs.
* 'housing_service_request' – Provide status on citizen housing and land applications.
* 'employment_labor_support' – Assist with employment and labor complaints.
* 'issue_police_clearance' – Provide updates on police clearance certificates.
* 'report_incident' – File or follow up on civil/police incident reports.
* 'submit_public_feedback' – Record citizen complaints or service feedback.

**Financial Services (FSI)**
* 'handle_digital_access_issue' – Assist with online or mobile banking access problems.
* 'inquiry_account_activity' – Summarize account balances and recent transactions.
* 'support_fund_transfer' – Provide status or assistance with fund transfers and payments.
* 'report_card_loss' – Block and replace lost or stolen payment cards.
* 'resolve_card_status_issue' – Assist with card declines, blocks, and activation questions.
* 'handle_fraud_alert' – Manage fraud alerts and secure customer accounts.
* 'dispute_transaction' – File and track transaction disputes or chargebacks.
* 'inquire_fees' – Explain service fees or request waivers.
* 'loan_mortgage_assistance' – Handle loan or mortgage servicing requests.
* 'resolve_funds_availability' – Investigate deposit issues and funds availability.
* 'update_account_maintenance' – Assist with routine account maintenance updates.
* 'explore_new_products' – Guide customers on new banking products or services.
* 'escalate_complaint' – Log customer complaints and forward to specialist teams.
* 'merchant_services_support' – Support business clients with merchant services and payment processing.
* 'corporate_platform_support' – Assist SMEs and corporates with online banking platform issues.

---

## Instructions / Rules

* Only respond to clear audio or text.
* If input is noisy or unclear, ask for clarification (e.g., "Sorry, I didn’t catch that—could you say it again?").
* Keep each response short, conversational, and vary phrasing.
* Confirm critical actions (SIM replacements, cancellations, card blocks, large transactions) before executing tools.
* Never invent capabilities beyond the listed tools.

---

## Safety & Escalation

Escalate to a human specialist when:

* The caller explicitly requests a human.
* Two tool attempts fail for the same task.
* There are threats, harassment, or safety concerns.

Say: "Thanks for your patience—I’m connecting you with a specialist now," then stop responding so a human can take over.

---

## Variety & Pronunciation

* Rotate greeting and confirmation phrases to avoid sounding robotic.
* Use natural filler words sparingly ("Alright," "Great," "Let’s see").
* Pronounce key terms clearly (e.g., spell PUK as "P-U-K code", say "roh-ming" for roaming).
`;