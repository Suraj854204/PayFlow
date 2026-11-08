export const TOUR_KEY = "payflow:tour:v1";
export const TOUR_EVENT = "payflow:start-tour";

export interface TourStep {
  /** Matches a `data-tour` attribute. Steps whose target is not on screen are skipped. */
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "dashboard",
    title: "Your dashboard",
    body: "Pay, approvals and deadlines for your role in one place. If you wear several hats, switch views at the top.",
  },
  {
    target: "nav",
    title: "Everything in one sidebar",
    body: "People, payroll, leave, expenses, tax and reports. You only see what your role is allowed to open.",
  },
  {
    target: "palette",
    title: "Jump anywhere with ⌘K",
    body: "Search pages and run actions from the keyboard. Press Ctrl+K on Windows and Linux.",
  },
  {
    target: "bell",
    title: "Notifications",
    body: "Approval requests, compliance reminders and company announcements land here.",
  },
  {
    target: "theme",
    title: "Light, dark and accent colours",
    body: "Toggle the theme here, and pick your own accent colour from your account menu.",
  },
];
