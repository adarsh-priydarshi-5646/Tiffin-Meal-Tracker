import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { AppData, HistoryItem, MealEntry, Person } from "@/lib/types";

export const dynamic = "force-dynamic";

const mealTypes = new Set(["none", "veg", "nonveg"]);
const actions = new Set(["saved", "updated", "reverted"]);
const paymentModes = new Set(["Cash", "UPI", "Bank"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAppData(value: unknown): value is AppData {
  if (!isRecord(value) || !Array.isArray(value.people) || !Array.isArray(value.entries) || !Array.isArray(value.history) || !Array.isArray(value.payments) || !isRecord(value.dayDetails) || !isRecord(value.settings)) return false;
  const settings = value.settings;
  if (![settings.vegPrice, settings.nonVegPrice].every((price) => typeof price === "number" && Number.isFinite(price)) || ![settings.currency, settings.startDate, settings.endDate, settings.editor].every((field) => typeof field === "string")) return false;
  return value.people.every((person) => isRecord(person) && typeof person.id === "string" && typeof person.name === "string" && typeof person.color === "string")
    && value.entries.every((entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.date === "string" && typeof entry.personId === "string" && typeof entry.createdAt === "string" && typeof entry.updatedAt === "string" && typeof entry.editedBy === "string" && typeof entry.deviceTime === "string" && mealTypes.has(String(entry.lunch)) && mealTypes.has(String(entry.dinner)))
    && value.history.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.date === "string" && typeof item.personId === "string" && typeof item.personName === "string" && typeof item.period === "string" && typeof item.meal === "string" && typeof item.savedAt === "string" && typeof item.deviceTime === "string" && typeof item.editedBy === "string" && actions.has(String(item.action)))
    && value.payments.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.month === "string" && typeof item.amount === "number" && (item.status === "paid" || item.status === "pending") && (item.mode === undefined || paymentModes.has(String(item.mode))));
}

async function readState(): Promise<AppData | null> {
  const [settings, people, entries, dayDetails, history, payments] = await prisma.$transaction([
    prisma.trackerSettings.findUnique({ where: { id: "default" } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    prisma.mealEntry.findMany({ where: { person: { active: true } } }),
    prisma.dayDetail.findMany(),
    prisma.history.findMany({ orderBy: { savedAt: "desc" } }),
    prisma.payment.findMany(),
  ]);
  if (!settings) return null;

  return {
    settings: { vegPrice: settings.vegPrice, nonVegPrice: settings.nonVegPrice, currency: settings.currency, startDate: settings.startDate, endDate: settings.endDate, editor: settings.editor },
    people: people.map((person): Person => ({ id: person.id, name: person.name, color: person.color })),
    entries: entries.map((entry): MealEntry => ({ id: entry.id, date: entry.date, personId: entry.personId, lunch: entry.lunch, dinner: entry.dinner, createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString(), editedBy: entry.editedBy, deviceTime: entry.deviceTime })),
    dayDetails: Object.fromEntries(dayDetails.map((detail) => [detail.date, { note: detail.note, image: detail.imageData ?? undefined, updatedAt: detail.updatedAt.toISOString() }])),
    history: history.map((item): HistoryItem => ({ id: item.id, date: item.date, personId: item.personId, personName: item.personName, period: item.period as HistoryItem["period"], meal: item.meal as HistoryItem["meal"], action: item.action, savedAt: item.savedAt.toISOString(), deviceTime: item.deviceTime, editedBy: item.editedBy })),
    payments: payments.map((payment) => ({ id: payment.id, month: payment.month, status: payment.status, paidAt: payment.paidAt?.toISOString(), amount: payment.amount, mode: payment.mode ?? undefined, reference: payment.reference ?? undefined })),
  };
}

export async function GET() {
  try {
    return NextResponse.json({ data: await readState() }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch {
    return NextResponse.json({ error: "Database is unavailable." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const candidate = isRecord(body) ? body.data : undefined;
    if (!isAppData(candidate)) return NextResponse.json({ error: "Invalid tracker data." }, { status: 400 });
    const data = candidate;
    const activeIds = data.people.map((person) => person.id);

    await prisma.$transaction(async (tx) => {
      await tx.trackerSettings.upsert({ where: { id: "default" }, update: data.settings, create: { id: "default", ...data.settings } });
      if (activeIds.length) await tx.user.updateMany({ where: { id: { notIn: activeIds } }, data: { active: false } });
      for (const person of data.people) {
        await tx.user.upsert({ where: { id: person.id }, update: { name: person.name, color: person.color, active: true }, create: { ...person, active: true } });
      }
      for (const entry of data.entries) {
        await tx.mealEntry.upsert({
          where: { date_personId: { date: entry.date, personId: entry.personId } },
          update: { id: entry.id, lunch: entry.lunch, dinner: entry.dinner, updatedAt: new Date(entry.updatedAt), editedBy: entry.editedBy, deviceTime: entry.deviceTime },
          create: { ...entry, createdAt: new Date(entry.createdAt), updatedAt: new Date(entry.updatedAt) },
        });
      }
      for (const [date, detail] of Object.entries(data.dayDetails)) {
        await tx.dayDetail.upsert({ where: { date }, update: { note: detail.note, imageData: detail.image, updatedAt: new Date(detail.updatedAt) }, create: { date, note: detail.note, imageData: detail.image, updatedAt: new Date(detail.updatedAt) } });
      }
      if (data.history.length) await tx.history.createMany({ data: data.history.map((item) => ({ ...item, savedAt: new Date(item.savedAt) })), skipDuplicates: true });
      for (const payment of data.payments) {
        await tx.payment.upsert({ where: { month: payment.month }, update: { id: payment.id, status: payment.status, paidAt: payment.paidAt ? new Date(payment.paidAt) : null, amount: payment.amount, mode: payment.mode, reference: payment.reference }, create: { ...payment, paidAt: payment.paidAt ? new Date(payment.paidAt) : undefined } });
      }
    });
    return NextResponse.json({ data: await readState() });
  } catch {
    return NextResponse.json({ error: "Unable to save tracker data." }, { status: 503 });
  }
}
