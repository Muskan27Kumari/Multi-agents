/**
 * Appointment service catalog for the Telegram booking bot.
 * Edit this file to add, remove, or change services.
 *
 * Fields:
 *   id           — number users reply with (must be unique)
 *   category     — group shown in the /book menu
 *   name         — display label
 *   duration_min — booking slot length in minutes
 *
 * "What to bring" lists live in scripts/appointment-requirements.js (by category).
 */
module.exports = [
  // General & Primary Care
  { id: '1', category: 'General & Primary Care', name: 'General Consultation', duration_min: 30 },
  { id: '2', category: 'General & Primary Care', name: 'Follow-up Visit', duration_min: 20 },
  { id: '3', category: 'General & Primary Care', name: 'Annual Physical / Health Checkup', duration_min: 45 },
  { id: '4', category: 'General & Primary Care', name: 'Preventive Care Visit', duration_min: 30 },
  { id: '5', category: 'General & Primary Care', name: 'Second Opinion Consultation', duration_min: 40 },
  { id: '6', category: 'General & Primary Care', name: 'Telehealth / Video Consultation', duration_min: 25 },

  // Diagnostics & Lab
  { id: '7', category: 'Diagnostics & Lab', name: 'Health Screening Package', duration_min: 60 },
  { id: '8', category: 'Diagnostics & Lab', name: 'Executive Health Checkup', duration_min: 90 },
  { id: '9', category: 'Diagnostics & Lab', name: 'Full Body Checkup', duration_min: 75 },
  { id: '10', category: 'Diagnostics & Lab', name: 'Lab Test / Blood Work', duration_min: 20 },
  { id: '11', category: 'Diagnostics & Lab', name: 'Urine Analysis', duration_min: 15 },
  { id: '12', category: 'Diagnostics & Lab', name: 'ECG / Heart Screening', duration_min: 30 },
  { id: '13', category: 'Diagnostics & Lab', name: 'X-Ray', duration_min: 20 },
  { id: '14', category: 'Diagnostics & Lab', name: 'Ultrasound', duration_min: 30 },
  { id: '15', category: 'Diagnostics & Lab', name: 'MRI Referral Consultation', duration_min: 25 },
  { id: '16', category: 'Diagnostics & Lab', name: 'CT Scan Referral Consultation', duration_min: 25 },
  { id: '17', category: 'Diagnostics & Lab', name: 'Allergy Testing', duration_min: 45 },
  { id: '18', category: 'Diagnostics & Lab', name: 'Diabetes Screening', duration_min: 30 },
  { id: '19', category: 'Diagnostics & Lab', name: 'Cholesterol / Lipid Panel', duration_min: 20 },
  { id: '20', category: 'Diagnostics & Lab', name: 'Thyroid Function Test', duration_min: 20 },
  { id: '21', category: 'Diagnostics & Lab', name: 'Liver Function Test', duration_min: 20 },
  { id: '22', category: 'Diagnostics & Lab', name: 'Kidney Function Test', duration_min: 20 },

  // Dental
  { id: '23', category: 'Dental', name: 'Dental Checkup', duration_min: 45 },
  { id: '24', category: 'Dental', name: 'Teeth Cleaning / Scaling', duration_min: 40 },
  { id: '25', category: 'Dental', name: 'Root Canal Consultation', duration_min: 30 },
  { id: '26', category: 'Dental', name: 'Tooth Extraction Consultation', duration_min: 25 },
  { id: '27', category: 'Dental', name: 'Orthodontics / Braces Consultation', duration_min: 35 },
  { id: '28', category: 'Dental', name: 'Cosmetic Dentistry Consultation', duration_min: 30 },

  // Eye Care
  { id: '29', category: 'Eye Care', name: 'Eye / Vision Checkup', duration_min: 30 },
  { id: '30', category: 'Eye Care', name: 'Contact Lens Fitting', duration_min: 25 },
  { id: '31', category: 'Eye Care', name: 'Glaucoma Screening', duration_min: 30 },
  { id: '32', category: 'Eye Care', name: 'Cataract Consultation', duration_min: 30 },

  // Dermatology & Skin
  { id: '33', category: 'Dermatology & Skin', name: 'Dermatology Consultation', duration_min: 30 },
  { id: '34', category: 'Dermatology & Skin', name: 'Acne Treatment Consultation', duration_min: 25 },
  { id: '35', category: 'Dermatology & Skin', name: 'Skin Allergy Consultation', duration_min: 25 },
  { id: '36', category: 'Dermatology & Skin', name: 'Hair Loss Consultation', duration_min: 30 },
  { id: '37', category: 'Dermatology & Skin', name: 'Cosmetic Dermatology', duration_min: 35 },

  // Cardiology & Heart
  { id: '38', category: 'Cardiology & Heart', name: 'Cardiology Consultation', duration_min: 40 },
  { id: '39', category: 'Cardiology & Heart', name: 'Blood Pressure Management', duration_min: 25 },
  { id: '40', category: 'Cardiology & Heart', name: 'Heart Health Follow-up', duration_min: 30 },

  // Orthopedics & Musculoskeletal
  { id: '41', category: 'Orthopedics & Musculoskeletal', name: 'Orthopedics Consultation', duration_min: 35 },
  { id: '42', category: 'Orthopedics & Musculoskeletal', name: 'Sports Injury Consultation', duration_min: 35 },
  { id: '43', category: 'Orthopedics & Musculoskeletal', name: 'Joint Pain Consultation', duration_min: 30 },
  { id: '44', category: 'Orthopedics & Musculoskeletal', name: 'Back & Neck Pain Consultation', duration_min: 30 },
  { id: '45', category: 'Orthopedics & Musculoskeletal', name: 'Fracture Follow-up', duration_min: 20 },
  { id: '46', category: 'Orthopedics & Musculoskeletal', name: 'Physiotherapy Session', duration_min: 45 },
  { id: '47', category: 'Orthopedics & Musculoskeletal', name: 'Rehabilitation Session', duration_min: 45 },
  { id: '48', category: 'Orthopedics & Musculoskeletal', name: 'Sports Physiotherapy', duration_min: 50 },

  // Women's Health
  { id: '49', category: "Women's Health", name: 'Gynecology Consultation', duration_min: 35 },
  { id: '50', category: "Women's Health", name: 'Prenatal / Antenatal Visit', duration_min: 40 },
  { id: '51', category: "Women's Health", name: 'Postnatal Checkup', duration_min: 35 },
  { id: '52', category: "Women's Health", name: 'Family Planning Consultation', duration_min: 30 },
  { id: '53', category: "Women's Health", name: 'Menopause Consultation', duration_min: 35 },

  // Pediatrics
  { id: '54', category: 'Pediatrics', name: 'Pediatric Consultation', duration_min: 30 },
  { id: '55', category: 'Pediatrics', name: 'Child Vaccination', duration_min: 20 },
  { id: '56', category: 'Pediatrics', name: 'Growth & Development Check', duration_min: 30 },
  { id: '57', category: 'Pediatrics', name: 'Newborn Wellness Visit', duration_min: 35 },

  // Mental Health & Wellness
  { id: '58', category: 'Mental Health & Wellness', name: 'Mental Health Counseling', duration_min: 50 },
  { id: '59', category: 'Mental Health & Wellness', name: 'Stress & Anxiety Counseling', duration_min: 45 },
  { id: '60', category: 'Mental Health & Wellness', name: 'Depression Support Session', duration_min: 50 },
  { id: '61', category: 'Mental Health & Wellness', name: 'Couples / Family Counseling', duration_min: 60 },

  // Nutrition & Lifestyle
  { id: '62', category: 'Nutrition & Lifestyle', name: 'Nutrition & Diet Planning', duration_min: 40 },
  { id: '63', category: 'Nutrition & Lifestyle', name: 'Weight Management Program', duration_min: 45 },
  { id: '64', category: 'Nutrition & Lifestyle', name: 'Diabetes Diet Counseling', duration_min: 40 },

  // Vaccination & Immunization
  { id: '65', category: 'Vaccination & Immunization', name: 'Adult Vaccination', duration_min: 15 },
  { id: '66', category: 'Vaccination & Immunization', name: 'Flu Shot', duration_min: 15 },
  { id: '67', category: 'Vaccination & Immunization', name: 'Travel Vaccination', duration_min: 25 },
  { id: '68', category: 'Vaccination & Immunization', name: 'COVID Vaccination', duration_min: 15 },

  // ENT (Ear, Nose & Throat)
  { id: '69', category: 'ENT', name: 'ENT Consultation', duration_min: 30 },
  { id: '70', category: 'ENT', name: 'Hearing Test', duration_min: 30 },
  { id: '71', category: 'ENT', name: 'Sinus / Allergy ENT Consult', duration_min: 30 },

  // Other Specialties
  { id: '72', category: 'Other Specialties', name: 'Urology Consultation', duration_min: 35 },
  { id: '73', category: 'Other Specialties', name: 'Kidney Stone Consultation', duration_min: 30 },
  { id: '74', category: 'Other Specialties', name: 'Gastroenterology Consultation', duration_min: 35 },
  { id: '75', category: 'Other Specialties', name: 'Digestive Health Consultation', duration_min: 30 },
  { id: '76', category: 'Other Specialties', name: 'Pulmonology / Respiratory Consult', duration_min: 35 },
  { id: '77', category: 'Other Specialties', name: 'Asthma Management', duration_min: 30 },
  { id: '78', category: 'Other Specialties', name: 'Neurology Consultation', duration_min: 40 },
  { id: '79', category: 'Other Specialties', name: 'Migraine / Headache Consultation', duration_min: 35 },
  { id: '80', category: 'Other Specialties', name: 'Oncology Consultation (Initial)', duration_min: 45 },
  { id: '81', category: 'Other Specialties', name: 'Cancer Care Follow-up', duration_min: 30 },
  { id: '82', category: 'Other Specialties', name: 'Endocrinology Consultation', duration_min: 35 },
  { id: '83', category: 'Other Specialties', name: 'Rheumatology Consultation', duration_min: 35 },
  { id: '84', category: 'Other Specialties', name: 'Nephrology Consultation', duration_min: 35 },
  { id: '85', category: 'Other Specialties', name: 'Hematology Consultation', duration_min: 35 },
  { id: '86', category: 'Other Specialties', name: 'Sleep Medicine Consultation', duration_min: 40 },
  { id: '87', category: 'Other Specialties', name: 'Pain Management Consultation', duration_min: 40 },
  { id: '88', category: 'Other Specialties', name: 'Geriatric / Senior Care Consultation', duration_min: 40 },

  // Movies & Entertainment
  { id: '89', category: 'Movies & Entertainment', name: 'Movie Ticket (Standard)', duration_min: 180 },
  { id: '90', category: 'Movies & Entertainment', name: 'Movie Ticket (3D / IMAX)', duration_min: 180 },
  { id: '91', category: 'Movies & Entertainment', name: 'Concert Ticket', duration_min: 180 },
  { id: '92', category: 'Movies & Entertainment', name: 'Theater / Play Ticket', duration_min: 150 },
  { id: '93', category: 'Movies & Entertainment', name: 'Sports Event Ticket', duration_min: 180 },
  { id: '94', category: 'Movies & Entertainment', name: 'Theme Park Ticket', duration_min: 480 },
  { id: '95', category: 'Movies & Entertainment', name: 'Museum Entry Ticket', duration_min: 120 },
  { id: '96', category: 'Movies & Entertainment', name: 'Amusement Park Pass', duration_min: 360 },
  { id: '97', category: 'Movies & Entertainment', name: 'Comedy Show Ticket', duration_min: 120 },
  { id: '98', category: 'Movies & Entertainment', name: 'Live Music / DJ Event', duration_min: 180 },
  { id: '99', category: 'Movies & Entertainment', name: 'Stand-up Comedy Night', duration_min: 120 },
  { id: '100', category: 'Movies & Entertainment', name: 'Exhibition / Expo Entry', duration_min: 180 },

  // Travel & Transport
  { id: '101', category: 'Travel & Transport', name: 'Bus Ticket', duration_min: 120 },
  { id: '102', category: 'Travel & Transport', name: 'Intercity Bus Ticket', duration_min: 360 },
  { id: '103', category: 'Travel & Transport', name: 'Volvo / AC Bus Ticket', duration_min: 360 },
  { id: '104', category: 'Travel & Transport', name: 'Sleeper Bus Ticket', duration_min: 480 },
  { id: '105', category: 'Travel & Transport', name: 'Train Ticket (General)', duration_min: 180 },
  { id: '106', category: 'Travel & Transport', name: 'Train Ticket (AC)', duration_min: 240 },
  { id: '107', category: 'Travel & Transport', name: 'Train Ticket (Sleeper)', duration_min: 480 },
  { id: '108', category: 'Travel & Transport', name: 'Flight Ticket Booking', duration_min: 180 },
  { id: '109', category: 'Travel & Transport', name: 'Domestic Flight Booking', duration_min: 180 },
  { id: '110', category: 'Travel & Transport', name: 'International Flight Booking', duration_min: 240 },
  { id: '111', category: 'Travel & Transport', name: 'Metro / Subway Pass', duration_min: 60 },
  { id: '112', category: 'Travel & Transport', name: 'Ferry / Boat Ticket', duration_min: 120 },
  { id: '113', category: 'Travel & Transport', name: 'Taxi / Cab Booking', duration_min: 60 },
  { id: '114', category: 'Travel & Transport', name: 'Ride Share Booking (Uber/Ola)', duration_min: 45 },
  { id: '115', category: 'Travel & Transport', name: 'Car Rental Booking', duration_min: 1440 },
  { id: '116', category: 'Travel & Transport', name: 'Bike / Scooter Rental', duration_min: 240 },
  { id: '117', category: 'Travel & Transport', name: 'Charter Bus Booking', duration_min: 480 },
  { id: '118', category: 'Travel & Transport', name: 'Airport Transfer', duration_min: 90 },

  // Hotels & Accommodation
  { id: '119', category: 'Hotels & Accommodation', name: 'Hotel Room Booking', duration_min: 1440 },
  { id: '120', category: 'Hotels & Accommodation', name: 'Resort Booking', duration_min: 1440 },
  { id: '121', category: 'Hotels & Accommodation', name: 'Homestay / Airbnb Booking', duration_min: 1440 },
  { id: '122', category: 'Hotels & Accommodation', name: 'Hostel Booking', duration_min: 720 },
  { id: '123', category: 'Hotels & Accommodation', name: 'Vacation Package', duration_min: 4320 },
  { id: '124', category: 'Hotels & Accommodation', name: 'Hourly Hotel Room', duration_min: 180 },
  { id: '125', category: 'Hotels & Accommodation', name: 'Lodge / Guest House Booking', duration_min: 720 },

  // Food & Dining
  { id: '126', category: 'Food & Dining', name: 'Restaurant Table Reservation', duration_min: 90 },
  { id: '127', category: 'Food & Dining', name: 'Cafe Booking', duration_min: 60 },
  { id: '128', category: 'Food & Dining', name: 'Banquet Hall Booking', duration_min: 240 },
  { id: '129', category: 'Food & Dining', name: 'Catering Service Booking', duration_min: 180 },
  { id: '130', category: 'Food & Dining', name: 'Private Dining Room', duration_min: 120 },
  { id: '131', category: 'Food & Dining', name: 'Food Delivery Slot Booking', duration_min: 30 },

  // Events & Celebrations
  { id: '132', category: 'Events & Celebrations', name: 'Wedding Venue Booking', duration_min: 480 },
  { id: '133', category: 'Events & Celebrations', name: 'Birthday Party Hall', duration_min: 240 },
  { id: '134', category: 'Events & Celebrations', name: 'Conference Room Booking', duration_min: 180 },
  { id: '135', category: 'Events & Celebrations', name: 'Event Photography Session', duration_min: 180 },
  { id: '136', category: 'Events & Celebrations', name: 'DJ / Entertainment Booking', duration_min: 240 },
  { id: '137', category: 'Events & Celebrations', name: 'Corporate Event Booking', duration_min: 360 },
  { id: '138', category: 'Events & Celebrations', name: 'Baby Shower / Naming Ceremony Hall', duration_min: 240 },

  // Beauty & Grooming
  { id: '139', category: 'Beauty & Grooming', name: 'Salon Appointment', duration_min: 60 },
  { id: '140', category: 'Beauty & Grooming', name: 'Barber / Haircut', duration_min: 30 },
  { id: '141', category: 'Beauty & Grooming', name: 'Spa & Massage', duration_min: 90 },
  { id: '142', category: 'Beauty & Grooming', name: 'Bridal Makeup', duration_min: 120 },
  { id: '143', category: 'Beauty & Grooming', name: 'Nail Art / Manicure', duration_min: 45 },
  { id: '144', category: 'Beauty & Grooming', name: 'Tattoo Consultation', duration_min: 60 },
  { id: '145', category: 'Beauty & Grooming', name: 'Threading / Waxing', duration_min: 30 },

  // Fitness & Recreation
  { id: '146', category: 'Fitness & Recreation', name: 'Gym Session Pass', duration_min: 90 },
  { id: '147', category: 'Fitness & Recreation', name: 'Yoga Class', duration_min: 60 },
  { id: '148', category: 'Fitness & Recreation', name: 'Personal Training', duration_min: 60 },
  { id: '149', category: 'Fitness & Recreation', name: 'Swimming Pool Pass', duration_min: 60 },
  { id: '150', category: 'Fitness & Recreation', name: 'Badminton Court Booking', duration_min: 60 },
  { id: '151', category: 'Fitness & Recreation', name: 'Tennis Court Booking', duration_min: 60 },
  { id: '152', category: 'Fitness & Recreation', name: 'Golf Tee Time', duration_min: 180 },
  { id: '153', category: 'Fitness & Recreation', name: 'Cricket Ground Booking', duration_min: 180 },
  { id: '154', category: 'Fitness & Recreation', name: 'Football Turf Booking', duration_min: 90 },

  // Education & Training
  { id: '155', category: 'Education & Training', name: 'Tutoring Session', duration_min: 60 },
  { id: '156', category: 'Education & Training', name: 'Online Course Enrollment', duration_min: 30 },
  { id: '157', category: 'Education & Training', name: 'Exam Registration', duration_min: 180 },
  { id: '158', category: 'Education & Training', name: 'Driving Lesson', duration_min: 60 },
  { id: '159', category: 'Education & Training', name: 'Language Class', duration_min: 60 },
  { id: '160', category: 'Education & Training', name: 'Workshop / Seminar Seat', duration_min: 180 },
  { id: '161', category: 'Education & Training', name: 'Career Counseling Session', duration_min: 45 },

  // Professional & Business
  { id: '162', category: 'Professional & Business', name: 'Legal Consultation', duration_min: 45 },
  { id: '163', category: 'Professional & Business', name: 'Tax / CA Consultation', duration_min: 45 },
  { id: '164', category: 'Professional & Business', name: 'Financial Advisory', duration_min: 45 },
  { id: '165', category: 'Professional & Business', name: 'Insurance Consultation', duration_min: 30 },
  { id: '166', category: 'Professional & Business', name: 'Real Estate Property Viewing', duration_min: 60 },
  { id: '167', category: 'Professional & Business', name: 'Business Meeting Room', duration_min: 60 },
  { id: '168', category: 'Professional & Business', name: 'Coworking Desk Booking', duration_min: 480 },
  { id: '169', category: 'Professional & Business', name: 'Notary / Documentation Service', duration_min: 30 },

  // Automotive Services
  { id: '170', category: 'Automotive Services', name: 'Car Service / Maintenance', duration_min: 120 },
  { id: '171', category: 'Automotive Services', name: 'Vehicle Inspection', duration_min: 60 },
  { id: '172', category: 'Automotive Services', name: 'Tire Change Service', duration_min: 45 },
  { id: '173', category: 'Automotive Services', name: 'Car Wash & Detailing', duration_min: 60 },
  { id: '174', category: 'Automotive Services', name: 'Two-Wheeler Service', duration_min: 90 },
  { id: '175', category: 'Automotive Services', name: 'EV Charging Slot Booking', duration_min: 60 },

  // Home Services
  { id: '176', category: 'Home Services', name: 'Plumbing Service', duration_min: 60 },
  { id: '177', category: 'Home Services', name: 'Electrical Service', duration_min: 60 },
  { id: '178', category: 'Home Services', name: 'AC Repair Service', duration_min: 90 },
  { id: '179', category: 'Home Services', name: 'Home Cleaning', duration_min: 120 },
  { id: '180', category: 'Home Services', name: 'Pest Control Service', duration_min: 90 },
  { id: '181', category: 'Home Services', name: 'Packers & Movers Consultation', duration_min: 45 },
  { id: '182', category: 'Home Services', name: 'Interior Design Consultation', duration_min: 60 },
  { id: '183', category: 'Home Services', name: 'Appliance Repair Service', duration_min: 60 },

  // Government & Official
  { id: '184', category: 'Government & Official', name: 'Passport Application Slot', duration_min: 60 },
  { id: '185', category: 'Government & Official', name: 'Visa Application Appointment', duration_min: 45 },
  { id: '186', category: 'Government & Official', name: 'Driving License Appointment', duration_min: 45 },
  { id: '187', category: 'Government & Official', name: 'RTO / Vehicle Registration', duration_min: 60 },
  { id: '188', category: 'Government & Official', name: 'Court / Legal Hearing Slot', duration_min: 120 },
];
