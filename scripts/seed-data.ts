/** Deterministic data for the demo seed: the same run always produces the same company. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIRST = [
  "Aarav",
  "Vivaan",
  "Aditya",
  "Arjun",
  "Rohan",
  "Karan",
  "Siddharth",
  "Rahul",
  "Amit",
  "Nikhil",
  "Priya",
  "Ananya",
  "Diya",
  "Isha",
  "Kavya",
  "Meera",
  "Neha",
  "Pooja",
  "Riya",
  "Sneha",
  "Tanvi",
  "Shruti",
  "Divya",
  "Anjali",
  "Swati",
  "Vikram",
  "Manish",
  "Suresh",
  "Deepak",
  "Gaurav",
  "Harsh",
  "Ishaan",
  "Kunal",
  "Lakshmi",
  "Mohan",
  "Naveen",
  "Omkar",
  "Pranav",
  "Rajesh",
  "Sanjay",
  "Tarun",
  "Uday",
  "Varun",
  "Yash",
  "Zoya",
  "Farhan",
  "Imran",
  "Sana",
  "Gurpreet",
  "Harleen",
];
export const LAST = [
  "Sharma",
  "Verma",
  "Iyer",
  "Nair",
  "Reddy",
  "Patel",
  "Shah",
  "Mehta",
  "Gupta",
  "Singh",
  "Kumar",
  "Das",
  "Bose",
  "Chatterjee",
  "Joshi",
  "Kulkarni",
  "Deshmukh",
  "Pillai",
  "Menon",
  "Rao",
  "Khan",
  "Ansari",
  "Gill",
  "Sandhu",
  "Bhatt",
];

export const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Sales",
  "People & HR",
  "Finance",
  "Operations",
] as const;

/** title, level, department, base annual CTC in rupees (before jitter) */
export const DESIGNATIONS: {
  title: string;
  level: number;
  dept: (typeof DEPARTMENTS)[number];
  ctc: number;
}[] = [
  { title: "Engineering Manager", level: 5, dept: "Engineering", ctc: 4_200_000 },
  { title: "Senior Software Engineer", level: 4, dept: "Engineering", ctc: 2_400_000 },
  { title: "Software Engineer", level: 3, dept: "Engineering", ctc: 1_400_000 },
  { title: "Associate Engineer", level: 2, dept: "Engineering", ctc: 800_000 },
  { title: "Product Manager", level: 5, dept: "Product", ctc: 3_600_000 },
  { title: "Product Designer", level: 3, dept: "Product", ctc: 1_500_000 },
  { title: "Sales Manager", level: 5, dept: "Sales", ctc: 3_000_000 },
  { title: "Account Executive", level: 3, dept: "Sales", ctc: 1_200_000 },
  { title: "Sales Associate", level: 2, dept: "Sales", ctc: 650_000 },
  { title: "HR Manager", level: 5, dept: "People & HR", ctc: 2_800_000 },
  { title: "HR Executive", level: 3, dept: "People & HR", ctc: 900_000 },
  { title: "Finance Manager", level: 5, dept: "Finance", ctc: 3_000_000 },
  { title: "Accountant", level: 3, dept: "Finance", ctc: 1_000_000 },
  { title: "Operations Manager", level: 5, dept: "Operations", ctc: 2_600_000 },
  { title: "Operations Executive", level: 2, dept: "Operations", ctc: 600_000 },
];

/** Public holidays (national and widely observed) for the seeded period. */
export const HOLIDAYS_2026: [string, string][] = [
  ["2026-01-26", "Republic Day"],
  ["2026-03-04", "Holi"],
  ["2026-04-03", "Good Friday"],
  ["2026-05-01", "Maharashtra Day"],
  ["2026-08-15", "Independence Day"],
  ["2026-09-14", "Ganesh Chaturthi"],
  ["2026-10-02", "Gandhi Jayanti"],
  ["2026-10-20", "Dussehra"],
  ["2026-11-08", "Diwali"],
  ["2026-12-25", "Christmas"],
];

export const POLICIES: { title: string; filename: string; pages: string[] }[] = [
  {
    title: "Leave policy",
    filename: "leave-policy.pdf",
    pages: [
      "Leave policy.\n\nEvery employee receives 12 days of casual leave, 12 days of sick leave and 15 days of earned leave in a financial year (April to March). Quotas are prorated for people who join during the year.\n\nCasual leave cannot be carried forward. Earned leave can be carried forward up to 30 days. Sick leave of more than 2 consecutive days needs a medical certificate.\n\nLeave is applied for in PayFlow and approved by the reporting manager. Leave without pay is deducted from salary for the days taken.",
      "Public holidays and weekly offs.\n\nSaturdays and Sundays are weekly offs. The company holiday list is published each January. Optional holidays can be taken in place of any listed holiday by applying for casual leave.\n\nMaternity leave follows the Maternity Benefit Act: 26 weeks for the first two children. Paternity leave is 10 working days within 6 months of the birth.",
    ],
  },
  {
    title: "Expense reimbursement policy",
    filename: "expense-policy.pdf",
    pages: [
      "Expense reimbursement.\n\nBusiness expenses are claimed in PayFlow within 30 days of the expense with the receipt attached. Claims above 5,000 rupees need manager approval and finance review. Travel by air is economy class unless a director approves otherwise.\n\nDaily food allowance while travelling is 800 rupees in metro cities and 500 rupees elsewhere. Alcohol is not reimbursable. Approved claims are paid with the next payroll run.",
    ],
  },
  {
    title: "Code of conduct",
    filename: "code-of-conduct.pdf",
    pages: [
      "Code of conduct.\n\nWe treat each other with respect. Harassment of any kind is not tolerated; complaints go to the Internal Committee, which acts within the timelines set by the POSH Act.\n\nConfidential company and customer information must not be shared outside the company. Gifts above 2,000 rupees from vendors must be declared to HR. Conflicts of interest must be disclosed in writing.\n\nWorking hours are 9:30 to 18:30, Monday to Friday. Saturdays and Sundays are weekly offs.",
    ],
  },
];
