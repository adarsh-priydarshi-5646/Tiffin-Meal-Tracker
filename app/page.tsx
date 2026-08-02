"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  parseISO,
  startOfMonth,
  subDays,
} from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Flame,
  History,
  ImagePlus,
  LayoutDashboard,
  Leaf,
  Moon,
  PencilLine,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  Settings2,
  Sun,
  Trash2,
  Utensils,
  X,
  Zap,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { colorOptions, defaultData, STORAGE_KEY } from "@/lib/defaults";
import type { AppData, DayDetail, HistoryItem, MealEntry, MealPeriod, MealType, Person, Tab } from "@/lib/types";

type MealDraft = Record<string, Pick<MealEntry, "lunch" | "dinner">>;
type ToastState = { message: string; undo?: boolean } | null;
type Stat = { meals: number; veg: number; nonVeg: number; lunch: number; dinner: number; total: number };

const navItems: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "bill", label: "Monthly bill", icon: ReceiptText },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const mealLabels: Record<MealType, string> = { none: "None", veg: "Veg", nonveg: "Non Veg" };
const periodLabels: Record<MealPeriod, string> = { lunch: "Lunch", dinner: "Dinner" };

const cloneData = (data: AppData): AppData => JSON.parse(JSON.stringify(data)) as AppData;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const dateFromKey = (key: string) => parseISO(`${key}T12:00:00`);
const dateKey = (date: Date) => format(date, "yyyy-MM-dd");
const prettyDate = (key: string, withWeekday = false) => format(dateFromKey(key), withWeekday ? "EEEE, d MMMM yyyy" : "d MMM yyyy");
const money = (amount: number, currency: string) => `${currency}${amount.toLocaleString("en-IN")}`;
const mealClass = (meal: MealType) => `meal-pill ${meal}`;

function normalizeAppData(parsed: Partial<AppData>): AppData {
  return {
    ...cloneData(defaultData),
    ...parsed,
    settings: { ...defaultData.settings, ...parsed.settings },
    people: parsed.people?.length ? parsed.people : cloneData(defaultData).people,
    entries: parsed.entries ?? [],
    dayDetails: parsed.dayDetails ?? {},
    history: parsed.history ?? [],
    payments: parsed.payments ?? [],
  };
}

function isInRange(key: string, data: AppData) {
  return key >= data.settings.startDate && key <= data.settings.endDate;
}

function findEntry(entries: MealEntry[], date: string, personId: string) {
  return entries.find((entry) => entry.date === date && entry.personId === personId);
}

function calculateStats(entries: MealEntry[], settings: AppData["settings"], personId?: string, month?: string): Stat {
  const scoped = entries.filter((entry) => (!personId || entry.personId === personId) && (!month || entry.date.startsWith(month)));
  let veg = 0;
  let nonVeg = 0;
  let lunch = 0;
  let dinner = 0;
  scoped.forEach((entry) => {
    (["lunch", "dinner"] as MealPeriod[]).forEach((period) => {
      const meal = entry[period];
      if (meal === "veg") veg += 1;
      if (meal === "nonveg") nonVeg += 1;
      if (meal !== "none" && period === "lunch") lunch += 1;
      if (meal !== "none" && period === "dinner") dinner += 1;
    });
  });
  return { meals: veg + nonVeg, veg, nonVeg, lunch, dinner, total: veg * settings.vegPrice + nonVeg * settings.nonVegPrice };
}

function emptyDraft(people: Person[], entries: MealEntry[], date: string): MealDraft {
  return Object.fromEntries(
    people.map((person) => {
      const entry = findEntry(entries, date, person.id);
      return [person.id, { lunch: entry?.lunch ?? "none", dinner: entry?.dinner ?? "none" }];
    }),
  ) as MealDraft;
}

function dayMealCount(entries: MealEntry[], date: string) {
  return entries.filter((entry) => entry.date === date).reduce((total, entry) => total + Number(entry.lunch !== "none") + Number(entry.dinner !== "none"), 0);
}

function downloadBlob(content: BlobPart, type: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
}

function MealPill({ meal }: { meal: MealType }) {
  return <span className={mealClass(meal)}>{meal === "veg" ? <Leaf size={10} /> : meal === "nonveg" ? <Utensils size={10} /> : null}{mealLabels[meal]}</span>;
}

export default function TiffinTracker() {
  const [data, setData] = useState<AppData>(() => cloneData(defaultData));
  const [ready, setReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<"checking" | "connected" | "local">("checking");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [activeMonth, setActiveMonth] = useState("2026-08");
  const [calendarMonth, setCalendarMonth] = useState("2026-08");
  const [darkMode, setDarkMode] = useState(false);
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<MealDraft>({});
  const [draftNote, setDraftNote] = useState("");
  const [draftImage, setDraftImage] = useState<string | undefined>();
  const [undoSnapshot, setUndoSnapshot] = useState<AppData | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPerson, setHistoryPerson] = useState("all");
  const [historyMeal, setHistoryMeal] = useState("all");
  const [historyDate, setHistoryDate] = useState("");
  const [newPerson, setNewPerson] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({ amount: 0, mode: "UPI" as "Cash" | "UPI" | "Bank", reference: "" });

  useEffect(() => {
    let cancelled = false;
    let localData = cloneData(defaultData);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) localData = normalizeAppData(JSON.parse(saved) as Partial<AppData>);
      const theme = window.localStorage.getItem(`${STORAGE_KEY}:theme`);
      setDarkMode(theme === "dark");
    } catch {
      // Invalid browser data should never prevent access to the tracker.
    }
    setData(localData);

    void fetch(`/api/state?_t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cloud storage is unavailable");
        const payload = await response.json() as { data?: AppData | null };
        if (!cancelled && payload.data) setData(normalizeAppData(payload.data));
        if (!cancelled) setCloudStatus("connected");
      })
      .catch(() => { if (!cancelled) setCloudStatus("local"); })
      .finally(() => { if (!cancelled) setReady(true); });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const retryCloudSync = () => setCloudStatus("checking");
    window.addEventListener("online", retryCloudSync);
    return () => window.removeEventListener("online", retryCloudSync);
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, ready]);

  useEffect(() => {
    if (!ready || cloudStatus === "local") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) setCloudStatus("local");
        else setCloudStatus("connected");
      }).catch(() => { if (!controller.signal.aborted) setCloudStatus("local"); });
    }, 600);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [data, ready, cloudStatus]);

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    if (ready) window.localStorage.setItem(`${STORAGE_KEY}:theme`, darkMode ? "dark" : "light");
  }, [darkMode, ready]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const currentDate = new Date();
  const todayKey = isInRange(dateKey(currentDate), data) ? dateKey(currentDate) : data.settings.startDate;
  const months = useMemo(
    () => eachMonthOfInterval({ start: dateFromKey(data.settings.startDate), end: dateFromKey(data.settings.endDate) }).map(dateKey).map((key) => key.slice(0, 7)),
    [data.settings.startDate, data.settings.endDate],
  );
  const monthStats = useMemo(() => calculateStats(data.entries, data.settings, undefined, activeMonth), [data, activeMonth]);
  const todayMeals = useMemo(() => dayMealCount(data.entries, todayKey), [data.entries, todayKey]);
  const billRows = useMemo(
    () => data.people.map((person) => ({ person, stats: calculateStats(data.entries, data.settings, person.id, activeMonth) })),
    [data.people, data.entries, data.settings, activeMonth],
  );
  const currentPayment = data.payments.find((payment) => payment.month === activeMonth);

  const recordHistory = (person: Person, date: string, period: MealPeriod, meal: MealType, action: HistoryItem["action"], now: string): HistoryItem => ({
    id: uid(),
    date,
    personId: person.id,
    personName: person.name,
    period,
    meal,
    action,
    savedAt: now,
    deviceTime: new Date().toString(),
    editedBy: data.settings.editor,
  });

  const persistDay = (date: string, nextDraft: MealDraft, detail: DayDetail, message: string) => {
    const before = cloneData(data);
    const now = new Date().toISOString();
    const nextEntries = [...data.entries];
    const events: HistoryItem[] = [];

    data.people.forEach((person) => {
      const oldEntry = findEntry(nextEntries, date, person.id);
      const choice = nextDraft[person.id] ?? { lunch: "none", dinner: "none" };
      if (!oldEntry) {
        const entry: MealEntry = {
          id: uid(), date, personId: person.id, lunch: choice.lunch, dinner: choice.dinner,
          createdAt: now, updatedAt: now, editedBy: data.settings.editor, deviceTime: new Date().toString(),
        };
        nextEntries.push(entry);
        events.push(recordHistory(person, date, "lunch", choice.lunch, "saved", now));
        events.push(recordHistory(person, date, "dinner", choice.dinner, "saved", now));
      } else if (oldEntry.lunch !== choice.lunch || oldEntry.dinner !== choice.dinner) {
        const index = nextEntries.findIndex((entry) => entry.id === oldEntry.id);
        nextEntries[index] = { ...oldEntry, lunch: choice.lunch, dinner: choice.dinner, updatedAt: now, editedBy: data.settings.editor, deviceTime: new Date().toString() };
        if (oldEntry.lunch !== choice.lunch) events.push(recordHistory(person, date, "lunch", choice.lunch, "updated", now));
        if (oldEntry.dinner !== choice.dinner) events.push(recordHistory(person, date, "dinner", choice.dinner, "updated", now));
      }
    });
    const previousDetail = data.dayDetails[date];
    if (previousDetail?.note !== detail.note || previousDetail?.image !== detail.image) {
      events.push({
        id: uid(), date, personId: "day", personName: "Day record", period: "day", meal: detail.image ? "photo" : "note", action: previousDetail ? "updated" : "saved",
        savedAt: now, deviceTime: new Date().toString(), editedBy: data.settings.editor,
      });
    }

    setUndoSnapshot(before);
    setData({
      ...data,
      entries: nextEntries,
      dayDetails: { ...data.dayDetails, [date]: { ...detail, updatedAt: now } },
      history: [...events, ...data.history],
    });
    setModalDate(null);
    setToast({ message, undo: true });
  };

  const openDate = (date: string) => {
    setModalDate(date);
    setDraft(emptyDraft(data.people, data.entries, date));
    setDraftNote(data.dayDetails[date]?.note ?? "");
    setDraftImage(data.dayDetails[date]?.image);
  };

  const updateMeal = (personId: string, period: MealPeriod, meal: MealType) => {
    setDraft((current) => ({ ...current, [personId]: { ...current[personId], [period]: meal } }));
  };

  const saveModal = () => {
    if (!modalDate) return;
    persistDay(modalDate, draft, { note: draftNote, image: draftImage, updatedAt: "" }, `${prettyDate(modalDate)} has been recorded with proof.`);
  };

  const applyPreset = (meal: MealType) => {
    const target = todayKey;
    const preset = emptyDraft(data.people, data.entries, target);
    data.people.forEach((person) => { preset[person.id] = { lunch: meal, dinner: meal }; });
    persistDay(target, preset, data.dayDetails[target] ?? { note: "", updatedAt: "" }, `Everyone marked ${mealLabels[meal]} for today.`);
  };

  const copyPreviousDay = () => {
    const previous = dateKey(subDays(dateFromKey(todayKey), 1));
    const previousDraft = emptyDraft(data.people, data.entries, previous);
    persistDay(todayKey, previousDraft, data.dayDetails[previous] ?? { note: "", updatedAt: "" }, "Yesterday’s meal plan copied to today.");
  };

  const undo = () => {
    if (!undoSnapshot) return;
    const now = new Date().toISOString();
    const revertedEvents = data.history.slice(0, 1).map((event) => ({ ...event, id: uid(), action: "reverted" as const, savedAt: now, deviceTime: new Date().toString() }));
    setData({ ...cloneData(undoSnapshot), history: [...revertedEvents, ...data.history] });
    setUndoSnapshot(null);
    setToast({ message: "Last change reverted. The audit trail remains intact." });
  };

  const handleImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setToast({ message: "Please choose an image file." }); return; }
    const reader = new FileReader();
    reader.onload = () => setDraftImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const updateSettings = (updates: Partial<AppData["settings"]>) => setData((current) => ({ ...current, settings: { ...current.settings, ...updates } }));
  const updatePerson = (id: string, name: string) => setData((current) => ({ ...current, people: current.people.map((person) => person.id === id ? { ...person, name } : person) }));
  const removePerson = (id: string) => {
    if (data.people.length === 1) { setToast({ message: "Keep at least one person in the tracker." }); return; }
    setData((current) => ({ ...current, people: current.people.filter((person) => person.id !== id) }));
  };
  const addPerson = () => {
    const name = newPerson.trim();
    if (!name) return;
    if (data.people.some((person) => person.name.toLowerCase() === name.toLowerCase())) { setToast({ message: "That person is already on the list." }); return; }
    setData((current) => ({ ...current, people: [...current.people, { id: uid(), name, color: colorOptions[current.people.length % colorOptions.length] }] }));
    setNewPerson("");
  };

  const billExportRows = billRows.map(({ person, stats }) => ({
    Person: person.name, "Veg meals": stats.veg, "Non Veg meals": stats.nonVeg, Lunch: stats.lunch, Dinner: stats.dinner,
    "Veg total": stats.veg * data.settings.vegPrice, "Non Veg total": stats.nonVeg * data.settings.nonVegPrice, "Grand total": stats.total,
  }));
  const exportCsv = () => {
    const headers = Object.keys(billExportRows[0] ?? { Person: "" });
    const lines = [headers.join(","), ...billExportRows.map((row) => headers.map((key) => JSON.stringify(row[key as keyof typeof row])).join(","))];
    downloadBlob(lines.join("\n"), "text/csv;charset=utf-8", `tiffin-bill-${activeMonth}.csv`);
    setToast({ message: "CSV bill downloaded." });
  };
  const exportExcel = () => {
    const headers = Object.keys(billExportRows[0] ?? { Person: "" });
    const escape = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
    const worksheet = `<html><head><meta charset="UTF-8" /></head><body><table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join("")}</tr></thead><tbody>${billExportRows.map((row) => `<tr>${headers.map((header) => `<td>${escape(row[header as keyof typeof row])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
    downloadBlob(worksheet, "application/vnd.ms-excel;charset=utf-8", `tiffin-bill-${activeMonth}.xls`);
    setToast({ message: "Excel bill downloaded." });
  };
  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(20); doc.text("The Daily Tiffin Tracker", 16, 19);
    doc.setFontSize(11); doc.text(`Monthly bill · ${format(parseISO(`${activeMonth}-01`), "MMMM yyyy")}`, 16, 28);
    let y = 42;
    billRows.forEach(({ person, stats }) => {
      doc.text(`${person.name} — Veg ${stats.veg}, Non Veg ${stats.nonVeg}, Lunch ${stats.lunch}, Dinner ${stats.dinner} — Total: Rs. ${stats.total}`, 16, y);
      y += 10;
    });
    doc.setFontSize(13); doc.text(`Grand total: Rs. ${monthStats.total}`, 16, y + 8);
    doc.save(`tiffin-bill-${activeMonth}.pdf`);
    setToast({ message: "PDF bill downloaded." });
  };

  const openPayment = () => {
    setPaymentDraft({ amount: currentPayment?.amount ?? monthStats.total, mode: currentPayment?.mode ?? "UPI", reference: currentPayment?.reference ?? "" });
    setPaymentOpen(true);
  };
  const savePayment = () => {
    const payment = { id: currentPayment?.id ?? uid(), month: activeMonth, status: "paid" as const, paidAt: new Date().toISOString(), amount: paymentDraft.amount, mode: paymentDraft.mode, reference: paymentDraft.reference };
    setData((current) => ({ ...current, payments: [...current.payments.filter((item) => item.month !== activeMonth), payment] }));
    setPaymentOpen(false); setToast({ message: `${format(parseISO(`${activeMonth}-01`), "MMMM")} marked as paid.` });
  };

  const historyRows = useMemo(() => data.history.filter((item) => {
    const haystack = `${item.personName} ${item.date} ${item.editedBy}`.toLowerCase();
    return (!historySearch || haystack.includes(historySearch.toLowerCase()))
      && (historyPerson === "all" || item.personId === historyPerson)
      && (historyMeal === "all" || item.meal === historyMeal)
      && (!historyDate || item.date === historyDate);
  }), [data.history, historySearch, historyPerson, historyMeal, historyDate]);

  const calendarDate = parseISO(`${calendarMonth}-01`);
  const calendarDays = eachDayOfInterval({ start: startOfMonth(calendarDate), end: endOfMonth(calendarDate) });
  const leadingBlanks = Array.from({ length: getDay(startOfMonth(calendarDate)) });
  const activeMonthIndex = months.indexOf(activeMonth);
  const calendarIndex = months.indexOf(calendarMonth);
  const monthName = format(parseISO(`${activeMonth}-01`), "MMMM yyyy");
  const streak = useMemo(() => {
    let count = 0;
    for (let day = dateFromKey(todayKey); day >= dateFromKey(data.settings.startDate); day = subDays(day, 1)) {
      if (dayMealCount(data.entries, dateKey(day)) === 0) break;
      count += 1;
    }
    return count;
  }, [data.entries, data.settings.startDate, todayKey]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && modalDate) { event.preventDefault(); saveModal(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setTab("history"); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  const pageTitles: Record<Tab, { eyebrow: string; title: string }> = {
    dashboard: { eyebrow: "Your household ledger", title: "Good afternoon, Adarsh." },
    calendar: { eyebrow: "Plan with proof", title: "Meal calendar" },
    bill: { eyebrow: "Clear monthly totals", title: "Monthly bill" },
    analytics: { eyebrow: "Trends at a glance", title: "Meal analytics" },
    history: { eyebrow: "Nothing gets lost", title: "Proof timeline" },
    settings: { eyebrow: "Make it your own", title: "Tracker settings" },
  };

  return (
    <main className="app-shell">
      <div className="shell-grid">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark"><Utensils size={19} /></div>
            <div><div className="brand-title">Tiffin Tracker</div><div className="brand-caption">Daily meal ledger</div></div>
          </div>
          <nav className="nav-list" aria-label="Main navigation">
            {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}><Icon size={18} /><span>{label}</span></button>)}
          </nav>
          <div className="sidebar-bottom">
            <div className="brand-caption">Tracking period</div>
            <div className="period-date">Aug 01 — Dec 31, 2026</div>
          </div>
        </aside>

        <section className={`page ${tab === "bill" ? "printing" : ""}`}>
          <header className="page-header">
            <div><div className="eyebrow">{pageTitles[tab].eyebrow}</div><h1 className="page-title">{pageTitles[tab].title}</h1></div>
            <div className="header-actions no-print">
              {undoSnapshot && <button className="button ghost" onClick={undo}><RotateCcw size={15} /><span>Undo</span></button>}
              <button className="icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle colour mode">{darkMode ? <Sun size={17} /> : <Moon size={17} />}</button>
              <button className="button primary" onClick={() => openDate(todayKey)}><PencilLine size={15} /><span>Record today</span></button>
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: .18 }}>
              {tab === "dashboard" && <DashboardView data={data} month={activeMonth} monthStats={monthStats} todayKey={todayKey} todayMeals={todayMeals} streak={streak} onOpenDate={openDate} onPreset={applyPreset} onCopyYesterday={copyPreviousDay} />}
              {tab === "calendar" && (
                <div className="calendar-layout">
                  <section className="panel flush calendar">
                    <div className="panel-header"><div><h2 className="panel-title">Order planner</h2><p className="panel-subtitle">Select any day to add meals, notes and a photo proof.</p></div><div className="month-controls"><button className="icon-button" disabled={calendarIndex <= 0} onClick={() => setCalendarMonth(months[calendarIndex - 1])}><ChevronLeft size={17} /></button><div className="month-label">{format(calendarDate, "MMMM yyyy")}</div><button className="icon-button" disabled={calendarIndex >= months.length - 1} onClick={() => setCalendarMonth(months[calendarIndex + 1])}><ChevronRight size={17} /></button></div></div>
                    <div className="weekday-grid">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => <div className="weekday" key={weekday}>{weekday}</div>)}</div>
                    <div className="calendar-grid">
                      {leadingBlanks.map((_, index) => <div className="calendar-placeholder" key={`blank-${index}`} />)}
                      {calendarDays.map((day) => {
                        const key = dateKey(day); const count = dayMealCount(data.entries, key); const detail = data.dayDetails[key];
                        return <button className={`calendar-day ${isSameDay(day, currentDate) ? "today" : ""} ${count ? "has-meals" : ""} ${!isInRange(key, data) ? "out-of-range" : ""}`} key={key} onClick={() => openDate(key)}><span className="day-number">{format(day, "d")}</span>{count > 0 && <div className="day-meal-lines">{data.people.slice(0, 3).map((person) => { const entry = findEntry(data.entries, key, person.id); const meals = Number(entry?.lunch !== "none" && !!entry) + Number(entry?.dinner !== "none" && !!entry); return meals ? <div className="day-meal-line" key={person.id}><i className="meal-dot" style={{ "--dot-color": person.color } as React.CSSProperties} /><b>{person.name.slice(0, 1)}</b> · {meals} meal{meals > 1 ? "s" : ""}</div> : null; })}</div>}{detail?.note && <span style={{ position: "absolute", left: 10, bottom: 8, color: "var(--orange)", fontSize: 10 }}>note</span>}</button>;
                      })}
                    </div>
                  </section>
                  <aside className="stack"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">{format(calendarDate, "MMMM")} at a glance</h2><p className="panel-subtitle">A transparent meal trail.</p></div></div><div className="calendar-summary"><div className="stat-line"><span>Ordered meals</span><strong>{calculateStats(data.entries, data.settings, undefined, calendarMonth).meals}</strong></div><div className="stat-line"><span>Veg meals</span><strong>{calculateStats(data.entries, data.settings, undefined, calendarMonth).veg}</strong></div><div className="stat-line"><span>Non Veg meals</span><strong>{calculateStats(data.entries, data.settings, undefined, calendarMonth).nonVeg}</strong></div><div className="stat-line"><span>Days with proof</span><strong>{Object.keys(data.dayDetails).filter((day) => day.startsWith(calendarMonth) && (data.dayDetails[day].note || data.dayDetails[day].image)).length}</strong></div></div></section><section className="panel"><div className="eyebrow">Tip</div><p className="panel-subtitle" style={{ marginTop: 8, lineHeight: 1.5 }}>Use <b>⌘ / Ctrl + S</b> to save a date while the meal editor is open. Every change is written to the proof timeline.</p></section></aside>
                </div>
              )}
              {tab === "bill" && <BillView data={data} month={activeMonth} months={months} monthName={monthName} stats={monthStats} rows={billRows} payment={currentPayment} onMonth={setActiveMonth} onPayment={openPayment} onCsv={exportCsv} onExcel={exportExcel} onPdf={exportPdf} />}
              {tab === "analytics" && <AnalyticsView data={data} months={months} />}
              {tab === "history" && <HistoryView data={data} rows={historyRows} search={historySearch} person={historyPerson} meal={historyMeal} date={historyDate} onSearch={setHistorySearch} onPerson={setHistoryPerson} onMeal={setHistoryMeal} onDate={setHistoryDate} />}
              {tab === "settings" && <SettingsView data={data} newPerson={newPerson} onNewPerson={setNewPerson} onAddPerson={addPerson} onRemovePerson={removePerson} onUpdatePerson={updatePerson} onSettings={updateSettings} />}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>

      <AnimatePresence>{modalDate && <MealModal date={modalDate} data={data} draft={draft} note={draftNote} image={draftImage} onClose={() => setModalDate(null)} onMeal={updateMeal} onNote={setDraftNote} onImage={handleImage} onRemoveImage={() => setDraftImage(undefined)} onSave={saveModal} />}</AnimatePresence>
      <AnimatePresence>{paymentOpen && <PaymentModal month={monthName} draft={paymentDraft} currency={data.settings.currency} onChange={setPaymentDraft} onClose={() => setPaymentOpen(false)} onSave={savePayment} />}</AnimatePresence>
      <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}><Check size={15} color="var(--pine)" /><span>{toast.message}</span>{toast.undo && <button onClick={undo}>Undo</button>}</motion.div>}</AnimatePresence>
    </main>
  );
}

function DashboardView({ data, month, monthStats, todayKey, todayMeals, streak, onOpenDate, onPreset, onCopyYesterday }: {
  data: AppData; month: string; monthStats: Stat; todayKey: string; todayMeals: number; streak: number;
  onOpenDate: (date: string) => void; onPreset: (meal: MealType) => void; onCopyYesterday: () => void;
}) {
  const recent = data.history.slice(0, 5);
  const peopleTotals = data.people.map((person) => ({ person, stats: calculateStats(data.entries, data.settings, person.id, month) }));
  return <div className="dashboard-grid">
    <div className="stack">
      <section className="stats-grid">
        <StatCard label="Total meals" value={monthStats.meals.toString()} note="This month" color="#dcece5" icon={<Utensils size={17} />} />
        <StatCard label="Veg meals" value={monthStats.veg.toString()} note="₹110 per meal" color="#e1f3e9" icon={<Leaf size={17} />} />
        <StatCard label="Non Veg meals" value={monthStats.nonVeg.toString()} note="₹160 per meal" color="#ffebe4" icon={<Utensils size={17} />} />
        <StatCard label="Total amount" value={money(monthStats.total, data.settings.currency)} note={format(parseISO(`${month}-01`), "MMMM 'bill'")} color="#eee7f6" icon={<CircleDollarSign size={17} />} />
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2 className="panel-title">Everyone’s monthly plate</h2><p className="panel-subtitle">A clear view of meals and running balances.</p></div><span className="brand-caption">{format(parseISO(`${month}-01`), "MMMM yyyy")}</span></div>
        <div className="person-grid">
          {peopleTotals.map(({ person, stats }) => <article className="person-card" key={person.id}>
            <div className="person-top"><div><div className="avatar" style={{ background: person.color }}>{person.name.slice(0, 1).toUpperCase()}</div><h3 className="person-name">{person.name}</h3><div className="person-bill">Current bill · <b>{money(stats.total, data.settings.currency)}</b></div></div><button className="icon-button" style={{ width: 31, height: 31 }} onClick={() => onOpenDate(todayKey)} aria-label={`Record meal for ${person.name}`}><Plus size={15} /></button></div>
            <div className="mini-stat-row"><div className="mini-stat"><strong>{stats.veg}</strong><span>Veg</span></div><div className="mini-stat"><strong>{stats.nonVeg}</strong><span>Non Veg</span></div><div className="mini-stat"><strong>{stats.lunch}/{stats.dinner}</strong><span>L / D</span></div></div>
          </article>)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2 className="panel-title">Latest proof records</h2><p className="panel-subtitle">Every save keeps the who, what and when.</p></div><span className="brand-caption">Immutable ledger</span></div>
        {recent.length ? <div className="meal-strip">{recent.map((event) => <div className="meal-strip-item" key={event.id}><div className="date-chip"><b>{format(dateFromKey(event.date), "d")}</b>{format(dateFromKey(event.date), "MMM")}</div><div className="meal-strip-details"><strong>{event.personName} · {event.period === "day" ? "Day record" : periodLabels[event.period]}</strong><span>{event.meal === "note" ? "Note updated" : event.meal === "photo" ? "Photo proof attached" : `${mealLabels[event.meal]} meal ${event.action}`}</span></div><span className="history-time">{format(parseISO(event.savedAt), "h:mm a")}</span></div>)}</div> : <EmptyState icon={<ClipboardCheck size={25} />} title="Your proof trail starts here" text="Record today’s order and each change will receive a timestamp, device time and editor name." />}
      </section>
    </div>

    <aside className="right-rail">
      <section className="today-callout"><div className="eyebrow">Today · {format(dateFromKey(todayKey), "d MMM")}</div><h3>{todayMeals ? `${todayMeals} meals on the card` : "What’s on the card?"}</h3><p>{todayMeals ? "Today’s order is safely recorded. Add a note or photo if there is anything to remember." : "Record lunch and dinner for everyone in one calm, quick step."}</p><button className="button" onClick={() => onOpenDate(todayKey)}><PencilLine size={15} />{todayMeals ? "Review today" : "Record today"}</button></section>
      <section className="panel"><div className="panel-header"><div><h2 className="panel-title">Quick actions</h2><p className="panel-subtitle">Built for the busy moments.</p></div><Zap size={16} color="var(--orange)" /></div><div className="quick-actions"><button className="quick-action" onClick={() => onPreset("veg")}><Leaf size={17} color="var(--pine)" /><strong>All Veg</strong><span>Lunch & dinner</span></button><button className="quick-action" onClick={() => onPreset("nonveg")}><Utensils size={17} color="var(--orange)" /><strong>All Non Veg</strong><span>Lunch & dinner</span></button><button className="quick-action" onClick={onCopyYesterday}><Copy size={17} color="var(--violet)" /><strong>Copy yesterday</strong><span>One click repeat</span></button><button className="quick-action" onClick={() => onOpenDate(todayKey)}><CalendarDays size={17} color="var(--pine)" /><strong>Open day</strong><span>Add note or proof</span></button></div></section>
      <section className="streak"><Flame size={26} color="var(--orange)" fill="var(--orange)" /><div><strong>{streak ? `${streak} day meal streak` : "Start your daily streak"}</strong><p>{streak ? "Each ordered day keeps the rhythm alive." : "Record today to keep every tiffin visible."}</p></div></section>
    </aside>
  </div>;
}

function StatCard({ label, value, note, color, icon }: { label: string; value: string; note: string; color: string; icon: React.ReactNode }) {
  return <article className="stat-card" style={{ "--stat-color": color } as React.CSSProperties}><div style={{ color: "var(--pine)" }}>{icon}</div><div className="eyebrow" style={{ marginTop: 9 }}>{label}</div><strong className="stat-number">{value}</strong><div className="stat-note">{note}</div></article>;
}

function BillView({ data, month, months, monthName, stats, rows, payment, onMonth, onPayment, onCsv, onExcel, onPdf }: {
  data: AppData; month: string; months: string[]; monthName: string; stats: Stat; rows: { person: Person; stats: Stat }[]; payment?: AppData["payments"][number];
  onMonth: (month: string) => void; onPayment: () => void; onCsv: () => void; onExcel: () => void; onPdf: () => void;
}) {
  return <div className="bill-layout">
    <section className="panel">
      <div className="panel-header no-print"><div><h2 className="panel-title">Invoice for {monthName}</h2><p className="panel-subtitle">Meal counts, totals and payment status in one shareable statement.</p></div><select className="select" style={{ width: 155 }} value={month} onChange={(event) => onMonth(event.target.value)}>{months.map((key) => <option value={key} key={key}>{format(parseISO(`${key}-01`), "MMMM yyyy")}</option>)}</select></div>
      <div className="print-only" style={{ padding: "19px 15px 6px" }}><h2>The Daily Tiffin Tracker</h2><p>Invoice for {monthName}</p></div>
      <div className="table-wrap"><table><thead><tr><th>Person</th><th>Veg</th><th>Non Veg</th><th>Lunch</th><th>Dinner</th><th>Veg total</th><th>Non Veg total</th><th>Grand total</th></tr></thead><tbody>{rows.map(({ person, stats: row }) => <tr key={person.id}><td><div style={{ display: "flex", alignItems: "center", gap: 8 }}><i className="color-dot" style={{ background: person.color }} /> <b>{person.name}</b></div></td><td>{row.veg}</td><td>{row.nonVeg}</td><td>{row.lunch}</td><td>{row.dinner}</td><td className="amount">{money(row.veg * data.settings.vegPrice, data.settings.currency)}</td><td className="amount">{money(row.nonVeg * data.settings.nonVegPrice, data.settings.currency)}</td><td className="amount">{money(row.total, data.settings.currency)}</td></tr>)}</tbody></table></div>
    </section>
    <aside className="stack no-print"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Statement</h2><p className="panel-subtitle">{monthName}</p></div><span className={`status-pill ${payment?.status === "paid" ? "paid" : "pending"}`}>{payment?.status === "paid" ? "Paid" : "Pending"}</span></div><div className="invoice-total"><span>Grand total</span><strong>{money(stats.total, data.settings.currency)}</strong><span>{stats.meals} meals · {stats.veg} Veg · {stats.nonVeg} Non Veg</span></div><div style={{ display: "grid", gap: 8, marginTop: 14 }}><button className="button primary" onClick={onPayment}><CircleDollarSign size={15} />{payment?.status === "paid" ? "Edit payment" : "Mark as paid"}</button>{payment?.status === "paid" && <div className="settings-note">Paid {payment.paidAt ? format(parseISO(payment.paidAt), "d MMM yyyy") : ""} via {payment.mode}. {payment.reference ? `Ref: ${payment.reference}` : ""}</div>}</div></section><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Export invoice</h2><p className="panel-subtitle">Take the exact same bill anywhere.</p></div></div><div className="export-list"><button className="export-item" onClick={onPdf}><FileText size={16} />Download PDF</button><button className="export-item" onClick={onExcel}><FileSpreadsheet size={16} />Download Excel</button><button className="export-item" onClick={onCsv}><Download size={16} />Download CSV</button><button className="export-item" onClick={() => window.print()}><Printer size={16} />Print friendly invoice</button></div></section></aside>
  </div>;
}

function AnalyticsView({ data, months }: { data: AppData; months: string[] }) {
  const monthly = months.map((month) => ({ month, stats: calculateStats(data.entries, data.settings, undefined, month) }));
  const maxSpend = Math.max(1, ...monthly.map((item) => item.stats.total));
  const allStats = calculateStats(data.entries, data.settings);
  const vegPercent = allStats.meals ? Math.round((allStats.veg / allStats.meals) * 100) : 50;
  const people = data.people.map((person) => ({ person, stats: calculateStats(data.entries, data.settings, person.id) }));
  const maxPeople = Math.max(1, ...people.map((item) => item.stats.meals));
  const trendEnd = data.settings.endDate < dateKey(new Date()) ? dateFromKey(data.settings.endDate) : dateFromKey(data.settings.startDate > dateKey(new Date()) ? data.settings.startDate : dateKey(new Date()));
  const trendDays = eachDayOfInterval({ start: subDays(trendEnd, 6), end: trendEnd }).filter((day) => isInRange(dateKey(day), data));
  return <div className="analytics-grid">
    <section className="panel"><div className="panel-header"><div><h2 className="panel-title">Monthly spending</h2><p className="panel-subtitle">A simple, honest view of every month in the meal period.</p></div><span className="amount">{money(allStats.total, data.settings.currency)} total</span></div><div className="chart-box">{monthly.map(({ month, stats }) => <div className="bar-group" key={month}><div className="bar" style={{ height: `${Math.max(3, (stats.total / maxSpend) * 100)}%` }} title={`${format(parseISO(`${month}-01`), "MMMM")}: ${money(stats.total, data.settings.currency)}`} /><div className="bar-label">{format(parseISO(`${month}-01`), "MMM")}</div></div>)}</div></section>
    <section className="panel"><div className="panel-header"><div><h2 className="panel-title">Meal mix</h2><p className="panel-subtitle">Veg vs Non Veg</p></div></div><div className="donut-wrap"><div className="donut" style={{ "--veg": `${vegPercent}%` } as React.CSSProperties}><div className="donut-inner"><div><strong>{allStats.meals}</strong><span>all meals</span></div></div></div></div><div className="legend" style={{ justifyContent: "center" }}><span style={{ "--legend": "var(--pine)" } as React.CSSProperties}><i />Veg · {allStats.veg}</span><span style={{ "--legend": "var(--orange)" } as React.CSSProperties}><i />Non Veg · {allStats.nonVeg}</span></div></section>
    <section className="panel"><div className="panel-header"><div><h2 className="panel-title">Meals per person</h2><p className="panel-subtitle">Share of the complete order history.</p></div></div><div className="person-bars">{people.map(({ person, stats }) => <div key={person.id}><div className="person-bar-label"><span>{person.name}</span><b>{stats.meals} meals · {money(stats.total, data.settings.currency)}</b></div><div className="progress"><div style={{ width: `${(stats.meals / maxPeople) * 100}%`, background: person.color }} /></div></div>)}</div></section>
    <section className="panel"><div className="panel-header"><div><h2 className="panel-title">Daily trend</h2><p className="panel-subtitle">The last seven days in this meal period.</p></div></div><div className="chart-box">{trendDays.length ? trendDays.map((day) => { const count = dayMealCount(data.entries, dateKey(day)); return <div className="bar-group" key={dateKey(day)}><div className="bar" style={{ height: `${Math.max(3, (count / Math.max(1, data.people.length * 2)) * 100)}%`, background: "var(--orange)" }} /><div className="bar-label">{format(day, "EEE")}</div></div>; }) : <EmptyState icon={<BarChart3 size={24} />} title="No dates to compare" text="Adjust your meal period to see daily trends." />}</div></section>
  </div>;
}

function HistoryView({ data, rows, search, person, meal, date, onSearch, onPerson, onMeal, onDate }: {
  data: AppData; rows: HistoryItem[]; search: string; person: string; meal: string; date: string;
  onSearch: (value: string) => void; onPerson: (value: string) => void; onMeal: (value: string) => void; onDate: (value: string) => void;
}) {
  return <section className="panel"><div className="panel-header"><div><h2 className="panel-title">Audit-proof history</h2><p className="panel-subtitle">Every meal record includes when it changed, who changed it and the device time.</p></div><span className="brand-caption">{data.history.length} events</span></div><div className="history-toolbar"><div style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 11, top: 12, color: "var(--ink-muted)" }} /><input className="field" style={{ paddingLeft: 33 }} placeholder="Search date, person or editor" value={search} onChange={(event) => onSearch(event.target.value)} /></div><select className="select" value={person} onChange={(event) => onPerson(event.target.value)}><option value="all">All people</option>{data.people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className="select" value={meal} onChange={(event) => onMeal(event.target.value)}><option value="all">All meals</option><option value="veg">Veg</option><option value="nonveg">Non Veg</option><option value="none">No meal</option></select><input className="field" type="date" value={date} onChange={(event) => onDate(event.target.value)} /></div>{rows.length ? <div className="history-list">{rows.map((item) => <div className="history-row" key={item.id}><div className="history-icon">{item.meal === "photo" ? <ImagePlus size={15} /> : item.meal === "note" ? <PencilLine size={15} /> : <ClipboardCheck size={15} />}</div><div className="history-main"><strong>{prettyDate(item.date)} · {item.personName}</strong><span>{item.period === "day" ? "Day evidence" : periodLabels[item.period]} · {item.meal === "note" ? "Note updated" : item.meal === "photo" ? "Photo proof attached" : mealLabels[item.meal]} · {item.action}</span></div>{item.meal === "note" || item.meal === "photo" ? <span className="meal-pill none">Evidence</span> : <MealPill meal={item.meal} />}<div className="history-time">{format(parseISO(item.savedAt), "d MMM · h:mm a")}<br />by {item.editedBy}</div></div>)}</div> : <EmptyState icon={<History size={25} />} title="No matching proof records" text="Try a different filter, or record a meal from the calendar to begin the audit trail." />}</section>;
}

function SettingsView({ data, newPerson, onNewPerson, onAddPerson, onRemovePerson, onUpdatePerson, onSettings }: {
  data: AppData; newPerson: string; onNewPerson: (value: string) => void; onAddPerson: () => void; onRemovePerson: (id: string) => void; onUpdatePerson: (id: string, name: string) => void; onSettings: (settings: Partial<AppData["settings"]>) => void;
}) {
  return <div className="settings-layout"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Meal setup</h2><p className="panel-subtitle">These are live settings; all new bills update immediately.</p></div></div><div className="form-grid"><div className="form-control"><label htmlFor="veg-price">Veg meal price</label><input id="veg-price" className="field" type="number" min="0" value={data.settings.vegPrice} onChange={(event) => onSettings({ vegPrice: Math.max(0, Number(event.target.value)) })} /></div><div className="form-control"><label htmlFor="nonveg-price">Non Veg meal price</label><input id="nonveg-price" className="field" type="number" min="0" value={data.settings.nonVegPrice} onChange={(event) => onSettings({ nonVegPrice: Math.max(0, Number(event.target.value)) })} /></div><div className="form-control"><label htmlFor="currency">Currency</label><select id="currency" className="select" value={data.settings.currency} onChange={(event) => onSettings({ currency: event.target.value })}><option value="₹">₹ Indian Rupee</option><option value="$">$ US Dollar</option><option value="€">€ Euro</option></select></div><div className="form-control"><label htmlFor="editor">Default editor</label><input id="editor" className="field" value={data.settings.editor} onChange={(event) => onSettings({ editor: event.target.value })} /></div><div className="form-control"><label htmlFor="period-start">Meal period starts</label><input id="period-start" className="field" type="date" value={data.settings.startDate} onChange={(event) => onSettings({ startDate: event.target.value })} /></div><div className="form-control"><label htmlFor="period-end">Meal period ends</label><input id="period-end" className="field" type="date" value={data.settings.endDate} onChange={(event) => onSettings({ endDate: event.target.value })} /></div></div><div className="settings-note" style={{ marginTop: 17 }}>Your changes are automatically saved on this device. The proof log retains the editor recorded at the time of every action.</div></section><section className="stack"><section className="panel"><div className="panel-header"><div><h2 className="panel-title">People</h2><p className="panel-subtitle">Each person gets their own meal count and bill.</p></div></div><div className="people-list">{data.people.map((person) => <div className="person-setting" key={person.id}><i className="color-dot" style={{ background: person.color }} /><input className="field" aria-label={`${person.name} name`} value={person.name} onChange={(event) => onUpdatePerson(person.id, event.target.value)} /><button aria-label={`Remove ${person.name}`} onClick={() => onRemovePerson(person.id)}><Trash2 size={15} /></button></div>)}</div><div style={{ display: "flex", gap: 8, marginTop: 10 }}><input className="field" placeholder="Add a person" value={newPerson} onChange={(event) => onNewPerson(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onAddPerson()} /><button className="button primary" onClick={onAddPerson}><Plus size={15} />Add</button></div></section><section className="panel"><div className="eyebrow">On this device</div><h2 className="panel-title" style={{ marginTop: 7 }}>Offline-ready by design</h2><p className="panel-subtitle" style={{ lineHeight: 1.5, marginTop: 8 }}>The tracker keeps an on-device copy of your orders, evidence and receipts. Install it from your browser menu for a focused mobile experience.</p></section></section></div>;
}

function MealModal({ date, data, draft, note, image, onClose, onMeal, onNote, onImage, onRemoveImage, onSave }: {
  date: string; data: AppData; draft: MealDraft; note: string; image?: string; onClose: () => void; onMeal: (personId: string, period: MealPeriod, meal: MealType) => void; onNote: (value: string) => void; onImage: (file?: File) => void; onRemoveImage: () => void; onSave: () => void;
}) {
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}><motion.section className="modal" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="meal-modal-title"><header className="modal-header"><div><div className="eyebrow">Daily meal record</div><h2 id="meal-modal-title">{prettyDate(date, true)}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close editor"><X size={17} /></button></header><div className="modal-body"><div className="meal-editor" style={{ paddingTop: 0 }}><div className="brand-caption">Person</div><div className="brand-caption">Lunch</div><div className="brand-caption">Dinner</div></div>{data.people.map((person) => <div className="meal-editor" key={person.id}><div className="editor-person"><span className="avatar" style={{ width: 27, height: 27, borderRadius: 9, background: person.color, fontSize: 10 }}>{person.name.slice(0, 1)}</span>{person.name}</div><MealChoice value={draft[person.id]?.lunch ?? "none"} onChange={(meal) => onMeal(person.id, "lunch", meal)} /><MealChoice value={draft[person.id]?.dinner ?? "none"} onChange={(meal) => onMeal(person.id, "dinner", meal)} /></div>)}<div className="modal-field"><label htmlFor="day-note">Day note <span style={{ fontWeight: 400 }}>(optional)</span></label><textarea id="day-note" placeholder="Outside food, a holiday, late delivery…" value={note} onChange={(event) => onNote(event.target.value)} /></div><div className="photo-row">{image ? <div className="photo-preview"><img src={image} alt="Tiffin proof preview" /></div> : <div className="photo-preview" style={{ display: "grid", placeItems: "center", color: "var(--ink-muted)" }}><ImagePlus size={17} /></div>}<label className="upload-label"><ImagePlus size={15} />Attach tiffin photo<input type="file" accept="image/*" onChange={(event) => onImage(event.target.files?.[0])} /></label>{image && <button className="button ghost small" onClick={onRemoveImage}>Remove</button>}</div></div><footer className="modal-footer"><div><button className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" onClick={onSave}><Check size={15} />Save record</button></div><span className="modal-proof">Time, device & editor will be saved</span></footer></motion.section></motion.div>;
}

function MealChoice({ value, onChange }: { value: MealType; onChange: (meal: MealType) => void }) {
  return <div className="meal-choice">{(["none", "veg", "nonveg"] as MealType[]).map((meal) => <button key={meal} className={value === meal ? "selected" : ""} style={{ "--choice": meal === "veg" ? "#257150" : meal === "nonveg" ? "#b45236" : "var(--ink-muted)" } as React.CSSProperties} onClick={() => onChange(meal)}>{mealLabels[meal]}</button>)}</div>;
}

function PaymentModal({ month, draft, currency, onChange, onClose, onSave }: { month: string; draft: { amount: number; mode: "Cash" | "UPI" | "Bank"; reference: string }; currency: string; onChange: (draft: { amount: number; mode: "Cash" | "UPI" | "Bank"; reference: string }) => void; onClose: () => void; onSave: () => void }) {
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}><motion.section className="modal" style={{ width: 460 }} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true"><header className="modal-header"><div><div className="eyebrow">Payment tracker</div><h2>Mark {month} paid</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header><div className="modal-body"><div className="modal-field"><label htmlFor="payment-amount">Amount paid ({currency})</label><input id="payment-amount" className="field" type="number" min="0" value={draft.amount} onChange={(event) => onChange({ ...draft, amount: Math.max(0, Number(event.target.value)) })} /></div><div className="modal-field"><label>Payment mode</label><div className="payment-options">{(["Cash", "UPI", "Bank"] as const).map((mode) => <button key={mode} className={draft.mode === mode ? "selected" : ""} onClick={() => onChange({ ...draft, mode })}>{mode}</button>)}</div></div><div className="modal-field"><label htmlFor="reference">Reference number <span style={{ fontWeight: 400 }}>(optional)</span></label><input id="reference" className="field" placeholder="Transaction / UPI reference" value={draft.reference} onChange={(event) => onChange({ ...draft, reference: event.target.value })} /></div></div><footer className="modal-footer"><div><button className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" onClick={onSave}><Check size={15} />Confirm payment</button></div></footer></motion.section></motion.div>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty"><div>{icon}<strong>{title}</strong><span>{text}</span></div></div>;
}
