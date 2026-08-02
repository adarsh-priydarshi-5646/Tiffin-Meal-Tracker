export type MealType = "none" | "veg" | "nonveg";
export type MealPeriod = "lunch" | "dinner";
export type Tab = "dashboard" | "calendar" | "bill" | "analytics" | "history" | "settings";

export interface Person {
  id: string;
  name: string;
  color: string;
}

export interface MealEntry {
  id: string;
  date: string;
  personId: string;
  lunch: MealType;
  dinner: MealType;
  createdAt: string;
  updatedAt: string;
  editedBy: string;
  deviceTime: string;
}

export interface DayDetail {
  note: string;
  image?: string;
  updatedAt: string;
}

export interface HistoryItem {
  id: string;
  date: string;
  personId: string;
  personName: string;
  period: MealPeriod | "day";
  meal: MealType | "note" | "photo";
  action: "saved" | "updated" | "reverted";
  savedAt: string;
  deviceTime: string;
  editedBy: string;
}

export interface Payment {
  id: string;
  month: string;
  status: "paid" | "pending";
  paidAt?: string;
  amount: number;
  mode?: "Cash" | "UPI" | "Bank";
  reference?: string;
}

export interface Settings {
  vegPrice: number;
  nonVegPrice: number;
  currency: string;
  startDate: string;
  endDate: string;
  editor: string;
}

export interface AppData {
  people: Person[];
  entries: MealEntry[];
  dayDetails: Record<string, DayDetail>;
  history: HistoryItem[];
  payments: Payment[];
  settings: Settings;
}
