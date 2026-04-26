import { create } from "zustand";

export type TabKey = "add" | "history" | "cards" | "balances";
export type AuthScreen = "landing" | "login" | "signup" | "app";

type BudgetStore = {
  tab: TabKey;
  authScreen: AuthScreen;
  currencyCode: "USD" | "PHP";
  selectedMonthKey: string;
  setTab: (tab: TabKey) => void;
  setAuthScreen: (screen: AuthScreen) => void;
  setCurrencyCode: (code: "USD" | "PHP") => void;
  setSelectedMonthKey: (monthKey: string) => void;
};

const pad2 = (value: number) => String(value).padStart(2, "0");
const current = new Date();
const defaultMonthKey = `${current.getFullYear()}-${pad2(current.getMonth() + 1)}`;

export const useBudgetStore = create<BudgetStore>((set) => ({
  tab: "add",
  authScreen: "landing",
  currencyCode: "USD",
  selectedMonthKey: defaultMonthKey,
  setTab: (tab) => set({ tab }),
  setAuthScreen: (authScreen) => set({ authScreen }),
  setCurrencyCode: (currencyCode) => set({ currencyCode }),
  setSelectedMonthKey: (selectedMonthKey) => set({ selectedMonthKey }),
}));
