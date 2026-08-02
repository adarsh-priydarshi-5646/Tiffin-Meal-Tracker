import type { AppData } from "./types";

export const STORAGE_KEY = "daily-tiffin-tracker:v1";

export const defaultData: AppData = {
  people: [
    { id: "adarsh", name: "Adarsh", color: "#315f55" },
    { id: "vidhit", name: "Vidhit", color: "#d66e45" },
    { id: "sravanth", name: "Sravanth", color: "#8c6bb1" },
  ],
  entries: [],
  dayDetails: {},
  history: [],
  payments: [],
  settings: {
    vegPrice: 110,
    nonVegPrice: 160,
    currency: "₹",
    startDate: "2026-08-01",
    endDate: "2026-12-31",
    editor: "Adarsh",
  },
};

export const colorOptions = ["#315f55", "#d66e45", "#8c6bb1", "#2d6f94", "#b15c7b", "#aa7a25"];
