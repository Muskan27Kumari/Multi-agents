/**
 * What to bring / prepare — keyed by service category.
 * Shown in Telegram confirmation and sent by email.
 */
const CATEGORY_REQUIREMENTS = {
  'General & Primary Care': [
    'Government photo ID (Aadhaar, PAN, Passport, or Driving License)',
    'Previous prescriptions and medical reports',
    'List of current medications (with dosage)',
    'Health insurance card (if applicable)',
    'Referral letter from another doctor (if any)',
  ],
  'Diagnostics & Lab': [
    'Government photo ID',
    'Doctor referral or prescription for tests',
    'Previous lab reports (if repeat tests)',
    'Fasting 8–12 hours for blood work (unless told otherwise)',
    'Comfortable clothing for imaging tests',
  ],
  'Dental': [
    'Government photo ID',
    'Previous dental X-rays or treatment records',
    'List of medications and allergies',
    'Insurance details (if applicable)',
    'Brush teeth before visit; avoid heavy meals right before',
  ],
  'Eye Care': [
    'Government photo ID',
    'Current glasses or contact lens prescription',
    'Previous eye exam reports',
    'List of eye medications (drops, etc.)',
    'Do not wear contact lenses on the day of certain tests',
  ],
  'Dermatology & Skin': [
    'Government photo ID',
    'List of current skin medications and products used',
    'Previous biopsy or allergy test reports',
    'Photos of skin condition (if symptoms vary)',
    'Avoid applying creams/lotions on affected area before visit',
  ],
  'Cardiology & Heart': [
    'Government photo ID',
    'Previous ECG, echo, or cardiac reports',
    'List of heart medications and blood pressure readings',
    'Health insurance card',
    'Wear comfortable clothes; avoid caffeine before tests if advised',
  ],
  'Orthopedics & Musculoskeletal': [
    'Government photo ID',
    'Previous X-ray, MRI, or physiotherapy reports',
    'List of pain medications and supplements',
    'Comfortable clothing; shorts for knee/leg exams if needed',
    'Referral from primary doctor (if required)',
  ],
  "Women's Health": [
    'Government photo ID',
    'Previous gynecology or pregnancy reports',
    'Menstrual cycle details (last period date)',
    'List of medications and supplements',
    'Insurance or maternity scheme documents (if applicable)',
  ],
  'Pediatrics': [
    'Child birth certificate or ID proof',
    'Vaccination card / immunization record',
    'Previous pediatric reports and growth charts',
    'List of current medications',
    'Parent/guardian photo ID',
  ],
  'Mental Health & Wellness': [
    'Government photo ID',
    'Previous counseling or psychiatric reports',
    'List of current medications',
    'Emergency contact details',
    'Quiet private space for telehealth sessions',
  ],
  'Nutrition & Lifestyle': [
    'Government photo ID',
    'Recent blood work or health reports',
    'Food diary or weight log (if available)',
    'List of supplements and medications',
    'Health goals written down',
  ],
  'Vaccination & Immunization': [
    'Government photo ID',
    'Previous vaccination card / records',
    'Allergy history',
    'Doctor prescription for travel vaccines (if applicable)',
    'Wear loose sleeves for arm injection',
  ],
  'ENT': [
    'Government photo ID',
    'Previous hearing or ENT reports',
    'List of medications and allergies',
    'Insurance details (if applicable)',
    'Avoid ear drops before hearing tests unless advised',
  ],
  'Other Specialties': [
    'Government photo ID',
    'Referral letter from primary doctor',
    'Previous specialist reports and test results',
    'List of current medications',
    'Health insurance card (if applicable)',
  ],
  'Movies & Entertainment': [
    'Booking confirmation (this message) or Booking ID',
    'Government photo ID matching ticket name',
    'Mobile phone for e-ticket / QR code',
    'Payment receipt (if paid offline)',
  ],
  'Travel & Transport': [
    'Government photo ID (Aadhaar, Passport, or Driving License)',
    'Booking ID and confirmation details',
    'Passport & visa (for international travel)',
    'Student / senior citizen ID for concessions (if applicable)',
    'Arrive 30–60 minutes before departure',
  ],
  'Hotels & Accommodation': [
    'Government photo ID (mandatory at check-in)',
    'Booking confirmation and Booking ID',
    'Payment card or advance payment receipt',
    'Corporate / GST details (for business stays)',
    'Special requests noted at booking (early check-in, etc.)',
  ],
  'Food & Dining': [
    'Booking confirmation and Booking ID',
    'Government photo ID (for large parties or prepaid bookings)',
    'Advance payment receipt (if applicable)',
    'Dietary restrictions communicated in advance',
    'Arrive 10–15 minutes before reservation time',
  ],
  'Events & Celebrations': [
    'Booking confirmation and Booking ID',
    'Government photo ID of event organizer',
    'Advance payment receipt / contract copy',
    'Guest list and seating plan (if applicable)',
    'Vendor contact details for coordination',
  ],
  'Beauty & Grooming': [
    'Booking confirmation',
    'Patch test results (for hair color / chemical treatments)',
    'List of allergies and skin sensitivities',
    'Reference photos for desired style (optional)',
    'Arrive with clean hair/skin as advised by salon',
  ],
  'Fitness & Recreation': [
    'Booking confirmation and Booking ID',
    'Government photo ID',
    'Sports shoes and appropriate workout attire',
    'Medical clearance (for intensive training, if required)',
    'Towel and water bottle',
  ],
  'Education & Training': [
    'Government photo ID',
    'Previous certificates or transcripts',
    'Enrollment confirmation and fee receipt',
    'Laptop / notebook for sessions',
    'Required documents listed in course brochure',
  ],
  'Professional & Business': [
    'Government photo ID',
    'Relevant contracts, tax returns, or property documents',
    'Previous consultation notes',
    'Business registration / GST documents (if applicable)',
    'List of questions prepared in advance',
  ],
  'Automotive Services': [
    'Vehicle registration certificate (RC)',
    'Insurance papers',
    'Previous service records',
    'Government photo ID',
    'Keys and spare key (for long service)',
  ],
  'Home Services': [
    'Booking confirmation',
    'Access to service area (keys, gate pass)',
    'Government photo ID for verification',
    'Previous repair invoices (if follow-up)',
    'Photos of issue (for remote diagnosis)',
  ],
  'Government & Official': [
    'Government photo ID (original + photocopy)',
    'All application forms duly filled and signed',
    'Supporting documents per official checklist',
    'Passport-size photographs (as required)',
    'Fee payment receipt / challan',
  ],
};

const DEFAULT_REQUIREMENTS = [
  'Booking confirmation and Booking ID',
  'Government photo ID',
  'Any documents related to your service request',
];

function getRequirementsForCategory(category) {
  return CATEGORY_REQUIREMENTS[category] || DEFAULT_REQUIREMENTS;
}

function enrichServicesWithRequirements(services) {
  return services.map((s) => ({
    ...s,
    requirements: s.requirements || getRequirementsForCategory(s.category),
  }));
}

function formatRequirementsList(requirements) {
  const list = Array.isArray(requirements) ? requirements : [];
  if (!list.length) return '';
  return list.map((r) => `• ${r}`).join('\n');
}

module.exports = {
  CATEGORY_REQUIREMENTS,
  DEFAULT_REQUIREMENTS,
  getRequirementsForCategory,
  enrichServicesWithRequirements,
  formatRequirementsList,
};
