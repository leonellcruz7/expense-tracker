"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChartLine,
  ChevronLeft,
  CreditCard,
  History,
  Loader2,
  Pencil,
  PlusCircle,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { hasSupabaseEnv, supabase } from "@/lib/supabase";
import { TabKey, useBudgetStore } from "@/store/use-budget-store";

type PaymentType = "cash" | "credit";

type CreditCardType = {
  id: string;
  name: string;
  cutoff_day: number;
};

type ExpenseType = {
  id: string;
  description: string;
  amount: number;
  currency_code: "USD" | "PHP";
  expense_date: string;
  payment_type: PaymentType;
  card_id: string | null;
  is_installment: boolean;
  installment_tenure_months: number | null;
  installment_monthly_amount: number | null;
  installment_months_paid: number;
  is_recurring: boolean;
};

type SpendingAnalysisResponse = {
  analysis: string;
  source?: string;
};
type AnalysisRecord = {
  id: string;
  period: "weekly" | "monthly";
  analysis: string;
  source: string | null;
  created_at: string;
};

const expenseSchema = z
  .object({
    amount: z.coerce.number().positive(),
    description: z.string().min(1),
    date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
    paymentType: z.enum(["cash", "credit"]),
    cardId: z.string().optional(),
    isInstallment: z.boolean(),
    isRecurring: z.boolean(),
    tenureMonths: z.coerce.number().int().min(1).optional(),
    monthsPaid: z.coerce.number().int().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.paymentType === "credit" && !data.cardId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select a credit card.", path: ["cardId"] });
    }
    if (data.paymentType === "credit" && data.isInstallment) {
      if ((data.tenureMonths ?? 0) < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tenure must be at least 1.", path: ["tenureMonths"] });
      }
      if ((data.monthsPaid ?? 0) > (data.tenureMonths ?? 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Months paid cannot exceed tenure.", path: ["monthsPaid"] });
      }
    }
    if (data.isInstallment && data.isRecurring) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose installment or recurring, not both.", path: ["isRecurring"] });
    }
  });

const cardSchema = z.object({
  name: z.string().min(1),
  cutoff_day: z.coerce.number().int().min(1).max(31),
});
type ExpenseFormValues = z.input<typeof expenseSchema>;
type CardFormValues = z.input<typeof cardSchema>;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const EMPTY_CARDS: CreditCardType[] = [];
const EMPTY_EXPENSES: ExpenseType[] = [];
const EMPTY_ANALYSES: AnalysisRecord[] = [];

const pad2 = (value: number) => String(value).padStart(2, "0");
const formatInputDate = (date: Date) => `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
const formatDbDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return `${pad2(day)}-${pad2(month)}-${year}`.replaceAll("-", "/");
};
const formatHistoryDate = (value: string) => {
  const [, month, day] = value.split("-").map(Number);
  if (!month || !day) return value;
  return `${MONTH_NAMES[month - 1]} ${day}`;
};
const parseInputDate = (value: string) => {
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) return null;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
};
const parseDbDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!day || !month || !year) return null;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
};
const toDbDate = (value: string) => {
  const parsed = parseInputDate(value);
  if (!parsed) return null;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
};
const getCurrencySymbol = (code: "USD" | "PHP") => (code === "USD" ? "$" : "₱");
const formatCurrencySymbol = (value: number, code: "USD" | "PHP") =>
  `${getCurrencySymbol(code)}${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
const SPINNERLESS_NUMBER_INPUT_CLASS =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
const HISTORY_CARD_FILTER_ALL = "__all__";
const HISTORY_CARD_FILTER_CASH = "__cash__";
const HISTORY_MONTH_FILTER_ALL = "__all__";
const ANALYSIS_HISTORY_FILTER_ALL = "__all__";
const formatAmountDisplay = (value: string) => {
  const sanitized = value.replace(/[^\d.]/g, "");
  const firstDotIndex = sanitized.indexOf(".");
  const normalized =
    firstDotIndex === -1 ? sanitized : `${sanitized.slice(0, firstDotIndex + 1)}${sanitized.slice(firstDotIndex + 1).replaceAll(".", "")}`;
  const [integerPartRaw = "", decimalPartRaw = ""] = normalized.split(".");
  const integerDigits = integerPartRaw.replace(/^0+(?=\d)/, "") || "0";
  const formattedInteger = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(integerDigits));
  if (normalized.endsWith(".")) return `${formattedInteger}.`;
  if (!normalized.includes(".")) return formattedInteger;
  return `${formattedInteger}.${decimalPartRaw.slice(0, 2)}`;
};
const parseAmountDisplay = (value: string) => {
  const parsed = Number.parseFloat(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const getStatementMonthKey = (expenseDate: Date, cutoffDay: number) => {
  const statementDate = new Date(expenseDate.getFullYear(), expenseDate.getMonth(), 1);
  if (expenseDate.getDate() > cutoffDay) statementDate.setMonth(statementDate.getMonth() + 1);
  return `${statementDate.getFullYear()}-${pad2(statementDate.getMonth() + 1)}`;
};

const monthOptions = () => {
  const current = new Date();
  const options: { key: string; label: string }[] = [];
  for (let offset = -6; offset <= 6; offset += 1) {
    const item = new Date(current.getFullYear(), current.getMonth() + offset, 1);
    options.push({ key: `${item.getFullYear()}-${pad2(item.getMonth() + 1)}`, label: `${MONTH_NAMES[item.getMonth()]} ${item.getFullYear()}` });
  }
  return options;
};
const getWeekStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
const getWeekEnd = (date: Date) => {
  const start = getWeekStart(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
};
const toDateKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const isLastDayOfMonth = (date: Date) => date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
const AnalysisResultSkeleton = () => (
  <div className="space-y-3">
    <div className="h-4 w-1/3 animate-pulse rounded bg-[#2a2f3a]" />
    <div className="space-y-2 rounded-xl border border-[#2a2f3a] bg-[#1d212c] p-3">
      <div className="h-3 w-5/6 animate-pulse rounded bg-[#2a2f3a]" />
      <div className="h-3 w-4/6 animate-pulse rounded bg-[#2a2f3a]" />
      <div className="h-3 w-3/6 animate-pulse rounded bg-[#2a2f3a]" />
    </div>
    <div className="space-y-2 rounded-xl border border-[#2a2f3a] bg-[#1d212c] p-3">
      <div className="h-3 w-4/6 animate-pulse rounded bg-[#2a2f3a]" />
      <div className="h-3 w-5/6 animate-pulse rounded bg-[#2a2f3a]" />
      <div className="h-3 w-2/6 animate-pulse rounded bg-[#2a2f3a]" />
    </div>
  </div>
);
const isTimestampWithinRange = (valueMs: number, startMs: number, endMs: number) => valueMs >= startMs && valueMs <= endMs;

export default function Home() {
  const queryClient = useQueryClient();
  const { tab, setTab, authScreen, setAuthScreen, currencyCode, setCurrencyCode, selectedMonthKey, setSelectedMonthKey } =
    useBudgetStore();

  const [authError, setAuthError] = useState("");
  const [formError, setFormError] = useState("");
  const [profileUserId, setProfileUserId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileProvider, setProfileProvider] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [amountDisplay, setAmountDisplay] = useState("0");
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editAmountDisplay, setEditAmountDisplay] = useState("0");
  const [editCardId, setEditCardId] = useState("");
  const [editTenureMonths, setEditTenureMonths] = useState("0");
  const [editMonthsPaid, setEditMonthsPaid] = useState("0");
  const [editIsRecurring, setEditIsRecurring] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardName, setEditCardName] = useState("");
  const [editCardCutoffDay, setEditCardCutoffDay] = useState("1");
  const [editError, setEditError] = useState("");
  const [isAddDatePickerOpen, setIsAddDatePickerOpen] = useState(false);
  const [isEditDatePickerOpen, setIsEditDatePickerOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyCardFilter, setHistoryCardFilter] = useState(HISTORY_CARD_FILTER_ALL);
  const [historyMonthFilter, setHistoryMonthFilter] = useState(HISTORY_MONTH_FILTER_ALL);
  const [balanceDetailType, setBalanceDetailType] = useState<"installments" | "recurring" | null>(null);
  const [expandedBalanceItems, setExpandedBalanceItems] = useState<Record<string, boolean>>({});
  const [analysisResult, setAnalysisResult] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [displayedAnalysis, setDisplayedAnalysis] = useState("");
  const [isTypingAnalysis, setIsTypingAnalysis] = useState(false);
  const [analysisHistoryFilter, setAnalysisHistoryFilter] = useState<"__all__" | "weekly" | "monthly">(ANALYSIS_HISTORY_FILTER_ALL);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>("");
  const [analysisSaveError, setAnalysisSaveError] = useState("");
  const [activeAnalysisPeriod, setActiveAnalysisPeriod] = useState<"weekly" | "monthly" | null>(null);
  const analysisTypingTimerRef = useRef<number | null>(null);
  const didHydrateAnalysisRef = useRef(false);
  const HISTORY_PAGE_SIZE = 10;
  const now = new Date();
  const isSunday = now.getDay() === 0;
  const isMonthEnd = isLastDayOfMonth(now);

  const startAnalysisTyping = (text: string) => {
    if (analysisTypingTimerRef.current) {
      window.clearInterval(analysisTypingTimerRef.current);
      analysisTypingTimerRef.current = null;
    }
    setDisplayedAnalysis("");
    setIsTypingAnalysis(true);

    let cursor = 0;
    const chunkSize = 8;
    analysisTypingTimerRef.current = window.setInterval(() => {
      cursor = Math.min(cursor + chunkSize, text.length);
      setDisplayedAnalysis(text.slice(0, cursor));
      if (cursor >= text.length) {
        if (analysisTypingTimerRef.current) {
          window.clearInterval(analysisTypingTimerRef.current);
          analysisTypingTimerRef.current = null;
        }
        setIsTypingAnalysis(false);
      }
    }, 18);
  };

  useEffect(
    () => () => {
      if (analysisTypingTimerRef.current) {
        window.clearInterval(analysisTypingTimerRef.current);
      }
    },
    [],
  );

  const cleanAnalysisLine = (line: string) => line.replaceAll("**", "").replace(/^[-*]\s+/, "").trim();
  const parsedAnalysisSections = useMemo(() => {
    const lines = displayedAnalysis.split("\n");
    const sections: { title: string; bullets: string[]; paragraphs: string[] }[] = [];
    let current: { title: string; bullets: string[]; paragraphs: string[] } | null = null;

    const pushCurrent = () => {
      if (!current) return;
      if (current.title || current.bullets.length > 0 || current.paragraphs.length > 0) {
        sections.push(current);
      }
      current = null;
    };

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      const headingMatch = line.match(/^(#{1,6}\s*|\d+\)\s*)(.+)$/);
      if (headingMatch) {
        pushCurrent();
        current = { title: cleanAnalysisLine(headingMatch[2]), bullets: [], paragraphs: [] };
        return;
      }
      if (!current) current = { title: "", bullets: [], paragraphs: [] };
      if (line.startsWith("- ") || line.startsWith("* ")) {
        current.bullets.push(cleanAnalysisLine(line));
      } else {
        current.paragraphs.push(cleanAnalysisLine(line));
      }
    });

    pushCurrent();
    return sections;
  }, [displayedAnalysis]);

  const expenseForm = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      amount: 0,
      description: "",
      date: formatInputDate(new Date()),
      paymentType: "cash",
      cardId: "",
      isInstallment: false,
      isRecurring: false,
      tenureMonths: 12,
      monthsPaid: 0,
    },
  });

  const cardForm = useForm<CardFormValues>({
    resolver: zodResolver(cardSchema),
    defaultValues: { name: "", cutoff_day: 1 },
  });

  const monthChoices = useMemo(() => monthOptions(), []);

  useEffect(() => {
    async function boot() {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (user) {
        setProfileUserId(user.id);
        setProfileEmail(user.email ?? "");
        setProfileName(typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "");
        setProfileProvider(user.app_metadata?.provider ?? "");
        setAuthScreen("app");
      }
    }
    boot();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      setProfileUserId(user?.id ?? "");
      setProfileEmail(user?.email ?? "");
      setProfileName(typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "");
      setProfileProvider(user?.app_metadata?.provider ?? "");
      setAuthScreen(user ? "app" : "landing");
    });

    return () => listener.subscription.unsubscribe();
  }, [setAuthScreen]);

  const cardsQuery = useQuery({
    queryKey: ["cards", profileUserId],
    enabled: authScreen === "app" && !!profileUserId,
    queryFn: async () => {
      const { data, error } = await supabase.from("credit_cards").select("id,name,cutoff_day").order("created_at", { ascending: true });
      if (error) throw error;
      return data as CreditCardType[];
    },
  });

  const expensesQuery = useQuery({
    queryKey: ["expenses", profileUserId],
    enabled: authScreen === "app" && !!profileUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select(
          "id,description,amount,currency_code,expense_date,payment_type,card_id,is_installment,installment_tenure_months,installment_monthly_amount,installment_months_paid,is_recurring",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ExpenseType[];
    },
  });

  const cards = cardsQuery.data ?? EMPTY_CARDS;
  const expenses = expensesQuery.data ?? EMPTY_EXPENSES;
  const analysisHistoryQuery = useQuery({
    queryKey: ["analysis-history", profileUserId],
    enabled: authScreen === "app" && !!profileUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spending_analyses")
        .select("id,period,analysis,source,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as AnalysisRecord[];
    },
  });
  const analysisHistory = analysisHistoryQuery.data ?? EMPTY_ANALYSES;
  const currentWeekStart = getWeekStart(now);
  const currentWeekEnd = getWeekEnd(now);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const currentWeekStartMs = currentWeekStart.getTime();
  const currentWeekEndMs = currentWeekEnd.getTime();
  const currentMonthStartMs = currentMonthStart.getTime();
  const currentMonthEndMs = currentMonthEnd.getTime();
  const hasWeeklyAnalysisForCurrentWeek = useMemo(
    () =>
      analysisHistory.some((entry) => {
        if (entry.period !== "weekly") return false;
        const createdAt = new Date(entry.created_at);
        const createdAtMs = createdAt.getTime();
        if (Number.isNaN(createdAtMs)) return false;
        return isTimestampWithinRange(createdAtMs, currentWeekStartMs, currentWeekEndMs);
      }),
    [analysisHistory, currentWeekEndMs, currentWeekStartMs],
  );
  const hasMonthlyAnalysisForCurrentMonth = useMemo(
    () =>
      analysisHistory.some((entry) => {
        if (entry.period !== "monthly") return false;
        const createdAt = new Date(entry.created_at);
        const createdAtMs = createdAt.getTime();
        if (Number.isNaN(createdAtMs)) return false;
        return isTimestampWithinRange(createdAtMs, currentMonthStartMs, currentMonthEndMs);
      }),
    [analysisHistory, currentMonthEndMs, currentMonthStartMs],
  );
  const filteredAnalysisHistory = useMemo(
    () =>
      analysisHistory.filter((item) => (analysisHistoryFilter === ANALYSIS_HISTORY_FILTER_ALL ? true : item.period === analysisHistoryFilter)),
    [analysisHistory, analysisHistoryFilter],
  );

  useEffect(() => {
    if (didHydrateAnalysisRef.current || analysisHistory.length === 0) return;
    const latest = analysisHistory[0];
    setAnalysisResult(latest.analysis);
    setDisplayedAnalysis(latest.analysis);
    setSelectedAnalysisId(latest.id);
    setIsTypingAnalysis(false);
    didHydrateAnalysisRef.current = true;
  }, [analysisHistory]);

  const addExpenseMutation = useMutation({
    mutationFn: async (values: ExpenseFormValues) => {
      const parsed = expenseSchema.parse(values);
      const dbDate = toDbDate(parsed.date);
      if (!dbDate) throw new Error("Date must be valid (DD/MM/YYYY).");
      const monthlyAmount =
        parsed.paymentType === "credit" && parsed.isInstallment
          ? Number((parsed.amount / Number(parsed.tenureMonths)).toFixed(2))
          : null;

      const { error } = await supabase.from("expenses").insert({
        user_id: profileUserId,
        description: parsed.description.trim(),
        amount: Number(parsed.amount.toFixed(2)),
        currency_code: currencyCode,
        expense_date: dbDate,
        payment_type: parsed.paymentType,
        card_id: parsed.paymentType === "credit" ? parsed.cardId : null,
        is_installment: parsed.paymentType === "credit" && parsed.isInstallment,
        is_recurring: parsed.paymentType === "credit" && parsed.isRecurring,
        installment_tenure_months: parsed.paymentType === "credit" && parsed.isInstallment ? parsed.tenureMonths : null,
        installment_monthly_amount: monthlyAmount,
        installment_months_paid: parsed.paymentType === "credit" && parsed.isInstallment ? parsed.monthsPaid : 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", profileUserId] });
      expenseForm.reset({
        amount: 0,
        description: "",
        date: formatInputDate(new Date()),
        paymentType: "cash",
        cardId: cards[0]?.id ?? "",
        isInstallment: false,
        isRecurring: false,
        tenureMonths: 12,
        monthsPaid: 0,
      });
      setAmountDisplay("0");
      setFormError("");
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const addCardMutation = useMutation({
    mutationFn: async (values: CardFormValues) => {
      const parsed = cardSchema.parse(values);
      const { error } = await supabase.from("credit_cards").insert({ user_id: profileUserId, name: parsed.name, cutoff_day: parsed.cutoff_day });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards", profileUserId] });
      cardForm.reset({ name: "", cutoff_day: 1 });
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses", profileUserId] }),
  });
  const updateExpenseMutation = useMutation({
    mutationFn: async (values: {
      item: ExpenseType;
      description: string;
      amount: number;
      expenseDate: string;
      cardId: string;
      tenureMonths: number;
      monthsPaid: number;
      isRecurring: boolean;
    }) => {
      const monthlyAmount = values.item.is_installment ? Number((values.amount / values.tenureMonths).toFixed(2)) : null;
      const { error } = await supabase
        .from("expenses")
        .update({
          description: values.description.trim(),
          amount: Number(values.amount.toFixed(2)),
          expense_date: values.expenseDate,
          card_id: values.item.payment_type === "credit" ? values.cardId : null,
          is_recurring: values.item.payment_type === "credit" ? values.isRecurring : false,
          installment_tenure_months: values.item.is_installment ? values.tenureMonths : null,
          installment_months_paid: values.item.is_installment ? values.monthsPaid : 0,
          installment_monthly_amount: monthlyAmount,
        })
        .eq("id", values.item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", profileUserId] });
      setEditingExpenseId(null);
      setEditError("");
    },
    onError: (error: Error) => setEditError(error.message),
  });

  const deleteCardMutation = useMutation({
    mutationFn: async (cardId: string) => {
      const { error } = await supabase.from("credit_cards").delete().eq("id", cardId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards", profileUserId] });
      queryClient.invalidateQueries({ queryKey: ["expenses", profileUserId] });
    },
  });
  const updateCardMutation = useMutation({
    mutationFn: async (values: { id: string; name: string; cutoffDay: number }) => {
      const parsed = cardSchema.parse({ name: values.name, cutoff_day: values.cutoffDay });
      const { error } = await supabase.from("credit_cards").update({ name: parsed.name, cutoff_day: parsed.cutoff_day }).eq("id", values.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards", profileUserId] });
      setEditingCardId(null);
      setEditError("");
    },
    onError: (error: Error) => setEditError(error.message),
  });
  const analyzeSpendingMutation = useMutation({
    mutationFn: async (period: "weekly" | "monthly") => {
      if (expenses.length === 0) throw new Error("Add a few expenses first so analysis has data.");
      if (period === "weekly" && !isSunday) throw new Error("Weekly analysis is available every Sunday only.");
      if (period === "monthly" && !isMonthEnd) throw new Error("Monthly analysis is available only on the last day of the month.");
      if (period === "weekly" && hasWeeklyAnalysisForCurrentWeek) throw new Error("Weekly analysis already generated for this week.");
      if (period === "monthly" && hasMonthlyAnalysisForCurrentMonth) throw new Error("Monthly analysis already generated for this month.");

      const currentPeriodRange =
        period === "weekly"
          ? { start: getWeekStart(now), end: getWeekEnd(now), label: "week" }
          : { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0), label: "month" };
      const previousPeriodRange =
        period === "weekly"
          ? {
              start: new Date(currentPeriodRange.start.getFullYear(), currentPeriodRange.start.getMonth(), currentPeriodRange.start.getDate() - 7),
              end: new Date(currentPeriodRange.end.getFullYear(), currentPeriodRange.end.getMonth(), currentPeriodRange.end.getDate() - 7),
            }
          : {
              start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
              end: new Date(now.getFullYear(), now.getMonth(), 0),
            };

      const currentStartKey = toDateKey(currentPeriodRange.start);
      const currentEndKey = toDateKey(currentPeriodRange.end);
      const previousStartKey = toDateKey(previousPeriodRange.start);
      const previousEndKey = toDateKey(previousPeriodRange.end);
      const currentTotal = expenses
        .filter((item) => item.expense_date >= currentStartKey && item.expense_date <= currentEndKey)
        .reduce((sum, item) => sum + Number(item.amount), 0);
      const previousTotal = expenses
        .filter((item) => item.expense_date >= previousStartKey && item.expense_date <= previousEndKey)
        .reduce((sum, item) => sum + Number(item.amount), 0);
      const trend = currentTotal < previousTotal ? "better" : currentTotal > previousTotal ? "worse" : "no_change";
      const previousSaved = analysisHistory.find((item) => item.period === period);

      const response = await fetch("/api/analyze-spending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expenses,
          cards,
          currencyCode,
          selectedMonthKey,
          analysisType: period,
          comparison: {
            currentTotal,
            previousTotal,
            trend,
            periodLabel: currentPeriodRange.label,
          },
          previousAnalysis: previousSaved?.analysis ?? null,
        }),
      });

      const payload = (await response.json()) as SpendingAnalysisResponse & { error?: string };
      if (!response.ok || !payload.analysis) {
        throw new Error(payload.error || "Unable to analyze spending right now.");
      }
      return { analysis: payload.analysis, source: payload.source ?? "openrouter", period };
    },
    onSuccess: async ({ analysis, source, period }) => {
      setAnalysisResult(analysis);
      setAnalysisError("");
      setAnalysisSaveError("");
      startAnalysisTyping(analysis);
      if (!profileUserId) return;
      const duplicateExists = analysisHistory.some((entry) => {
        if (entry.period !== period) return false;
        const createdAt = new Date(entry.created_at);
        const createdAtMs = createdAt.getTime();
        if (Number.isNaN(createdAtMs)) return false;
        if (period === "weekly") return isTimestampWithinRange(createdAtMs, currentWeekStartMs, currentWeekEndMs);
        return isTimestampWithinRange(createdAtMs, currentMonthStartMs, currentMonthEndMs);
      });
      if (duplicateExists) {
        setAnalysisSaveError(
          period === "weekly"
            ? "Weekly analysis already exists for this week. Please wait for next week."
            : "Monthly analysis already exists for this month. Please wait for next month.",
        );
        return;
      }
      const { error } = await supabase.from("spending_analyses").insert({
        user_id: profileUserId,
        period,
        analysis,
        source,
      });
      if (error) {
        setAnalysisSaveError("Analysis was generated but could not be saved. Check Supabase table setup.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["analysis-history", profileUserId] });
    },
    onError: (error: Error) => {
      setAnalysisError(error.message);
      setAnalysisResult("");
      setDisplayedAnalysis("");
      setIsTypingAnalysis(false);
      setAnalysisSaveError("");
    },
    onSettled: () => {
      setActiveAnalysisPeriod(null);
    },
  });
  const selectSavedAnalysis = (entry: AnalysisRecord) => {
    if (analysisTypingTimerRef.current) {
      window.clearInterval(analysisTypingTimerRef.current);
      analysisTypingTimerRef.current = null;
    }
    setIsTypingAnalysis(false);
    setAnalysisError("");
    setAnalysisSaveError("");
    setSelectedAnalysisId(entry.id);
    setAnalysisResult(entry.analysis);
    setDisplayedAnalysis(entry.analysis);
  };


  const totals = useMemo(() => {
    const cash = expenses.filter((item) => item.payment_type === "cash").reduce((sum, item) => sum + Number(item.amount), 0);
    const credit = expenses.filter((item) => item.payment_type === "credit").reduce((sum, item) => sum + Number(item.amount), 0);
    return { cash, credit, all: cash + credit };
  }, [expenses]);
  const currentMonthTotals = useMemo(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    const currentMonthExpenses = expenses.filter((item) => item.expense_date.startsWith(`${currentMonthKey}-`));
    const cash = currentMonthExpenses.filter((item) => item.payment_type === "cash").reduce((sum, item) => sum + Number(item.amount), 0);
    const credit = currentMonthExpenses.filter((item) => item.payment_type === "credit").reduce((sum, item) => sum + Number(item.amount), 0);
    return { cash, credit, all: cash + credit };
  }, [expenses]);
  const currentPeriodTotals = useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const startOfWeekKey = `${startOfWeek.getFullYear()}-${pad2(startOfWeek.getMonth() + 1)}-${pad2(startOfWeek.getDate())}`;

    const dailyTotal = expenses
      .filter((item) => item.expense_date === todayKey)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const weeklyTotal = expenses
      .filter((item) => item.expense_date >= startOfWeekKey && item.expense_date <= todayKey)
      .reduce((sum, item) => sum + Number(item.amount), 0);

    return { daily: dailyTotal, weekly: weeklyTotal };
  }, [expenses]);

  const monthlyBalances = useMemo(() => {
    return cards.map((card) => {
      const included: { id: string; label: string; amount: number }[] = [];
      expenses
        .filter((item) => item.payment_type === "credit" && item.card_id === card.id)
        .forEach((item) => {
          const parsedDate = parseDbDate(item.expense_date);
          if (!parsedDate) return;
          const baseMonthKey = getStatementMonthKey(parsedDate, card.cutoff_day);
          if (item.is_recurring) {
            if (baseMonthKey <= selectedMonthKey) {
              included.push({
                id: `${item.id}-${selectedMonthKey}`,
                label: `${formatHistoryDate(item.expense_date)} - ${item.description} (Recurring)`,
                amount: Number(item.amount),
              });
            }
            return;
          }
          if (!item.is_installment || !item.installment_tenure_months || !item.installment_monthly_amount) {
            if (baseMonthKey === selectedMonthKey) {
              included.push({
                id: item.id,
                label: `${formatHistoryDate(item.expense_date)} - ${item.description}`,
                amount: Number(item.amount),
              });
            }
            return;
          }

          const [startYear, startMonth] = baseMonthKey.split("-").map(Number);
          for (let idx = item.installment_months_paid; idx < item.installment_tenure_months; idx += 1) {
            const cycleDate = new Date(startYear, startMonth - 1 + idx, 1);
            const cycleKey = `${cycleDate.getFullYear()}-${pad2(cycleDate.getMonth() + 1)}`;
            if (cycleKey === selectedMonthKey) {
              included.push({
                id: `${item.id}-${idx}`,
                label: `${formatHistoryDate(item.expense_date)} - ${item.description} ${idx + 1}/${item.installment_tenure_months}`,
                amount: Number(item.installment_monthly_amount),
              });
            }
          }
        });

      return { card, included, total: included.reduce((sum, line) => sum + line.amount, 0) };
    });
  }, [cards, expenses, selectedMonthKey]);
  const allCardsTotalBalance = useMemo(
    () => monthlyBalances.reduce((sum, { total }) => sum + total, 0),
    [monthlyBalances],
  );
  const installmentBalanceItems = useMemo(() => {
    return cards.flatMap((card) => {
      return expenses
        .filter((item) => item.payment_type === "credit" && item.card_id === card.id && item.is_installment)
        .flatMap((item) => {
          const parsedDate = parseDbDate(item.expense_date);
          if (!parsedDate || !item.installment_tenure_months || !item.installment_monthly_amount) return [];
          const baseMonthKey = getStatementMonthKey(parsedDate, card.cutoff_day);
          const [startYear, startMonth] = baseMonthKey.split("-").map(Number);
          for (let idx = item.installment_months_paid; idx < item.installment_tenure_months; idx += 1) {
            const cycleDate = new Date(startYear, startMonth - 1 + idx, 1);
            const cycleKey = `${cycleDate.getFullYear()}-${pad2(cycleDate.getMonth() + 1)}`;
            if (cycleKey === selectedMonthKey) {
              return [
                {
                  id: `${item.id}-${idx}`,
                  expense: item,
                  amount: Number(item.installment_monthly_amount),
                  label: `${formatHistoryDate(item.expense_date)} - ${item.description} ${idx + 1}/${item.installment_tenure_months}`,
                },
              ];
            }
          }
          return [];
        });
    });
  }, [cards, expenses, selectedMonthKey]);
  const totalInstallmentsBalance = useMemo(
    () => installmentBalanceItems.reduce((sum, item) => sum + item.amount, 0),
    [installmentBalanceItems],
  );
  const recurringBalanceItems = useMemo(() => {
    return cards.flatMap((card) => {
      return expenses
        .filter((item) => item.payment_type === "credit" && item.card_id === card.id && item.is_recurring)
        .flatMap((item) => {
          const parsedDate = parseDbDate(item.expense_date);
          if (!parsedDate) return [];
          const baseMonthKey = getStatementMonthKey(parsedDate, card.cutoff_day);
          if (baseMonthKey > selectedMonthKey) return [];
          return [
            {
              id: `${item.id}-${selectedMonthKey}`,
              expense: item,
              amount: Number(item.amount),
              label: `${formatHistoryDate(item.expense_date)} - ${item.description}`,
            },
          ];
        });
    });
  }, [cards, expenses, selectedMonthKey]);
  const totalRecurringBalance = useMemo(
    () => recurringBalanceItems.reduce((sum, item) => sum + item.amount, 0),
    [recurringBalanceItems],
  );
  const cashBalance = useMemo(() => {
    const included = expenses
      .filter((item) => item.payment_type === "cash")
      .flatMap((item) => {
        const parsedDate = parseDbDate(item.expense_date);
        if (!parsedDate) return [];
        const monthKey = `${parsedDate.getFullYear()}-${pad2(parsedDate.getMonth() + 1)}`;
        if (monthKey !== selectedMonthKey) return [];
        return [
          {
            id: item.id,
            label: `${formatHistoryDate(item.expense_date)} - ${item.description}`,
            amount: Number(item.amount),
          },
        ];
      });

    return {
      included,
      total: included.reduce((sum, line) => sum + line.amount, 0),
    };
  }, [expenses, selectedMonthKey]);
  const historyMonthOptions = useMemo(() => {
    const seen = new Set<string>();
    return expenses
      .map((item) => item.expense_date.slice(0, 7))
      .filter((key) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((key) => {
        const [year, month] = key.split("-").map(Number);
        return {
          key,
          label: `${MONTH_NAMES[month - 1]} ${year}`,
        };
      });
  }, [expenses]);
  const filteredHistoryExpenses = useMemo(
    () =>
      expenses.filter((item) => {
        const matchesCard =
          historyCardFilter === HISTORY_CARD_FILTER_ALL
            ? true
            : historyCardFilter === HISTORY_CARD_FILTER_CASH
              ? item.payment_type === "cash"
              : item.card_id === historyCardFilter;
        const matchesMonth = historyMonthFilter === HISTORY_MONTH_FILTER_ALL ? true : item.expense_date.startsWith(`${historyMonthFilter}-`);
        return matchesCard && matchesMonth;
      }),
    [expenses, historyCardFilter, historyMonthFilter],
  );
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistoryExpenses.length / HISTORY_PAGE_SIZE));
  const currentHistoryPage = Math.min(historyPage, historyTotalPages);
  const paginatedExpenses = useMemo(() => {
    const start = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
    return filteredHistoryExpenses.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredHistoryExpenses, currentHistoryPage]);

  const handleLogin = async () => {
    setAuthError("");
    setIsAuthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
      if (error) setAuthError(error.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignup = async () => {
    if (signupPassword !== signupConfirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }
    setAuthError("");
    setIsAuthLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: signupEmail.trim(),
        password: signupPassword,
        options: { data: { full_name: signupName.trim() } },
      });
      if (error) setAuthError(error.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(error.message);
  };

  const navItems: { key: TabKey; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { key: "add", icon: PlusCircle, label: "Add" },
    { key: "history", icon: History, label: "History" },
    { key: "cards", icon: CreditCard, label: "Cards" },
    { key: "balances", icon: ChartLine, label: "Balances" },
    { key: "analysis", icon: Sparkles, label: "Analysis" },
  ];

  const pageTitles: Record<TabKey, string> = {
    add: "Add Expense",
    history: "Expense History",
    cards: "Credit Cards",
    balances: "Balances",
    analysis: "Spending Analysis",
  };

  const paymentType = useWatch({ control: expenseForm.control, name: "paymentType" });
  const isInstallment = useWatch({ control: expenseForm.control, name: "isInstallment" });
  const isRecurring = useWatch({ control: expenseForm.control, name: "isRecurring" });
  const amountInput = useWatch({ control: expenseForm.control, name: "amount" });
  const dateInput = useWatch({ control: expenseForm.control, name: "date" });
  const descriptionInput = useWatch({ control: expenseForm.control, name: "description" });
  const cardIdInput = useWatch({ control: expenseForm.control, name: "cardId" });
  const tenureInput = useWatch({ control: expenseForm.control, name: "tenureMonths" });
  const paidInput = useWatch({ control: expenseForm.control, name: "monthsPaid" });
  const cardNameInput = useWatch({ control: cardForm.control, name: "name" });
  const cardCutoffInput = useWatch({ control: cardForm.control, name: "cutoff_day" });
  const amount = Number(amountInput || 0);
  const selectedExpenseDate = parseInputDate(dateInput);
  const tenure = Number(tenureInput || 0);
  const paid = Number(paidInput || 0);
  const computedMonthlyPayment = tenure > 0 ? amount / tenure : 0;
  const computedRemainingBalance = Math.max(amount - paid * computedMonthlyPayment, 0);
  const computedRemainingMonths = Math.max(tenure - paid, 0);
  const editingDate = parseInputDate(editDate);

  const startEditingExpense = (item: ExpenseType) => {
    setEditingExpenseId(item.id);
    setEditDescription(item.description);
    setEditDate(formatDbDate(item.expense_date));
    setEditAmountDisplay(formatAmountDisplay(String(item.amount)));
    setEditCardId(item.card_id ?? "");
    setEditTenureMonths(String(item.installment_tenure_months ?? 0));
    setEditMonthsPaid(String(item.installment_months_paid ?? 0));
    setEditIsRecurring(item.is_recurring);
    setEditError("");
  };

  const cancelEditingExpense = () => {
    setEditingExpenseId(null);
    setEditError("");
  };
  const startEditingCard = (card: CreditCardType) => {
    setEditingCardId(card.id);
    setEditCardName(card.name);
    setEditCardCutoffDay(String(card.cutoff_day));
    setEditError("");
  };
  const cancelEditingCard = () => {
    setEditingCardId(null);
    setEditError("");
  };
  const saveEditingCard = (card: CreditCardType) => {
    const trimmedName = editCardName.trim();
    if (!trimmedName) {
      setEditError("Card name is required.");
      return;
    }
    const parsedCutoffDay = Number(editCardCutoffDay || 0);
    if (!Number.isInteger(parsedCutoffDay) || parsedCutoffDay < 1 || parsedCutoffDay > 31) {
      setEditError("Cutoff day must be between 1 and 31.");
      return;
    }
    setEditError("");
    updateCardMutation.mutate({ id: card.id, name: trimmedName, cutoffDay: parsedCutoffDay });
  };

  const saveEditingExpense = (item: ExpenseType) => {
    const trimmedDescription = editDescription.trim();
    if (!trimmedDescription) {
      setEditError("Description is required.");
      return;
    }
    const parsedAmount = parseAmountDisplay(editAmountDisplay);
    if (parsedAmount <= 0) {
      setEditError("Amount must be greater than 0.");
      return;
    }
    const dbDate = toDbDate(editDate);
    if (!dbDate) {
      setEditError("Date must be valid.");
      return;
    }
    if (item.payment_type === "credit" && !editCardId) {
      setEditError("Select a credit card.");
      return;
    }
    const parsedTenure = Number(editTenureMonths || 0);
    const parsedMonthsPaid = Number(editMonthsPaid || 0);
    if (item.is_installment) {
      if (!Number.isInteger(parsedTenure) || parsedTenure < 1) {
        setEditError("Tenure must be at least 1.");
        return;
      }
      if (!Number.isInteger(parsedMonthsPaid) || parsedMonthsPaid < 0) {
        setEditError("Months paid must be 0 or more.");
        return;
      }
      if (parsedMonthsPaid > parsedTenure) {
        setEditError("Months paid cannot exceed tenure.");
        return;
      }
    }
    if (item.is_installment && editIsRecurring) {
      setEditError("Choose installment or recurring, not both.");
      return;
    }
    setEditError("");
    updateExpenseMutation.mutate({
      item,
      description: trimmedDescription,
      amount: parsedAmount,
      expenseDate: dbDate,
      cardId: editCardId,
      tenureMonths: item.is_installment ? parsedTenure : 0,
      monthsPaid: item.is_installment ? parsedMonthsPaid : 0,
      isRecurring: item.payment_type === "credit" ? editIsRecurring : false,
    });
  };

  if (!hasSupabaseEnv) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#05070d] p-6 text-[#f3f4f6]">
        <Card className="w-full max-w-xl">
          <CardContent className="space-y-3 p-6">
            <h1 className="text-2xl font-semibold">Missing Supabase env vars</h1>
            <p className="text-sm text-[#a1a8b3]">Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `web-expense-tracker/.env.local`.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (authScreen !== "app") {
    return (
      <div className="min-h-screen bg-[#05070d] px-5 py-6 text-[#f3f4f6]">
        {authScreen === "landing" ? (
          <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center gap-8">
            <div>
              <h1 className="text-5xl font-semibold">Budget Tracker</h1>
              <p className="mt-2 text-lg text-[#a1a8b3]">Track expenses, credit cards, billing cycles, and installments in one place.</p>
            </div>
            <Card>
              <CardContent className="space-y-3 p-5">
                <Button className="w-full bg-[#0a84ff]" onClick={() => setAuthScreen("login")}>Login</Button>
                <Button className="w-full" variant="outline" onClick={() => setAuthScreen("signup")}>Create Account</Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="mx-auto max-w-xl space-y-5">
            <div className="flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={() => setAuthScreen("landing")}><ChevronLeft className="h-5 w-5" /></Button>
              <h2 className="text-2xl font-semibold">{authScreen === "login" ? "Login" : "Sign Up"}</h2>
              <div className="h-10 w-10" />
            </div>

            <Card>
              <CardContent className="space-y-3 p-4">
                {authScreen === "signup" && <Input placeholder="Full Name" value={signupName} onChange={(e) => setSignupName(e.target.value)} />}
                <Input placeholder="Email" value={authScreen === "login" ? loginEmail : signupEmail} onChange={(e) => (authScreen === "login" ? setLoginEmail(e.target.value) : setSignupEmail(e.target.value))} />
                <Input type="password" placeholder="Password" value={authScreen === "login" ? loginPassword : signupPassword} onChange={(e) => (authScreen === "login" ? setLoginPassword(e.target.value) : setSignupPassword(e.target.value))} />
                {authScreen === "signup" && <Input type="password" placeholder="Confirm password" value={signupConfirmPassword} onChange={(e) => setSignupConfirmPassword(e.target.value)} />}
              </CardContent>
            </Card>

            {authError ? <p className="text-sm text-[#fb7185]">{authError}</p> : null}
            <Button className="w-full bg-[#0a84ff]" onClick={authScreen === "login" ? handleLogin : handleSignup} disabled={isAuthLoading}>
              {isAuthLoading ? (authScreen === "login" ? "Logging in..." : "Creating account...") : authScreen === "login" ? "Login" : "Create Account"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070d] text-[#f3f4f6]">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-3">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-3xl font-semibold">{pageTitles[tab]}</h1>
          <Button variant="outline" size="icon" onClick={() => setShowSettings(true)}><Settings className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 space-y-4 pb-24">
          {tab === "add" && (
            <>
              <Card>
                <CardContent className="space-y-4 p-4">
                  <div className="flex rounded-full border border-[#2a2f3a] bg-[#1d212c] p-1">
                    <button className={`flex-1 rounded-full py-2 ${paymentType === "cash" ? "bg-[#343845]" : ""}`} onClick={() => expenseForm.setValue("paymentType", "cash")}>Cash</button>
                    <button className={`flex-1 rounded-full py-2 ${paymentType === "credit" ? "bg-[#343845]" : ""}`} onClick={() => expenseForm.setValue("paymentType", "credit")}>Credit Card</button>
                  </div>

                  <div className="flex items-end gap-3">
                    <Button variant="outline" onClick={() => setCurrencyCode(currencyCode === "USD" ? "PHP" : "USD")}>{currencyCode}</Button>
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="h-16 text-right text-5xl font-bold text-[#ff4d4f]"
                      value={amountDisplay}
                      onChange={(e) => {
                        const formatted = formatAmountDisplay(e.target.value);
                        setAmountDisplay(formatted);
                        expenseForm.setValue("amount", parseAmountDisplay(formatted), { shouldValidate: true });
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              <p className="px-1 text-xs text-[#a1a8b3]">GENERAL</p>
              <Card>
                <CardContent className="space-y-3 p-3">
                  <Popover open={isAddDatePickerOpen} onOpenChange={setIsAddDatePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start gap-2 text-left font-normal text-[#a1a8b3]"
                      >
                        <CalendarDays className="h-4 w-4 text-[#7d8596]" />
                        {selectedExpenseDate ? formatInputDate(selectedExpenseDate) : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={selectedExpenseDate ?? undefined}
                        onSelect={(date) => {
                          if (!date) return;
                          expenseForm.setValue("date", formatInputDate(date), { shouldValidate: true });
                          setIsAddDatePickerOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <Input value={descriptionInput} onChange={(e) => expenseForm.setValue("description", e.target.value)} placeholder="e.g. Groceries" />
                  {paymentType === "credit" && (
                    <Select
                      value={cardIdInput || undefined}
                      onValueChange={(value) => expenseForm.setValue("cardId", value === "__none__" ? "" : value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Card" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select Card</SelectItem>
                      {cards.map((card) => (
                        <SelectItem key={card.id} value={card.id}>{card.name}</SelectItem>
                      ))}
                      </SelectContent>
                    </Select>
                  )}
                </CardContent>
              </Card>

              {paymentType === "credit" && (
                <>
                  <p className="px-1 text-xs text-[#a1a8b3]">MORE DETAIL</p>
                  <Card>
                    <CardContent className="space-y-3 p-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={isInstallment}
                          onCheckedChange={(value) => {
                            expenseForm.setValue("isInstallment", value);
                            if (value) expenseForm.setValue("isRecurring", false);
                          }}
                        />
                        <span>Installment</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={isRecurring}
                          onCheckedChange={(value) => {
                            expenseForm.setValue("isRecurring", value);
                            if (value) expenseForm.setValue("isInstallment", false);
                          }}
                        />
                        <span>Recurring (monthly)</span>
                      </div>
                      {isInstallment && (
                        <div className="space-y-3 text-sm text-[#a1a8b3]">
                          <Input className={SPINNERLESS_NUMBER_INPUT_CLASS} type="number" value={String(tenureInput ?? 12)} onChange={(e) => expenseForm.setValue("tenureMonths", Number(e.target.value))} placeholder="Tenure" />
                          <Input className={SPINNERLESS_NUMBER_INPUT_CLASS} type="number" value={String(paidInput ?? 0)} onChange={(e) => expenseForm.setValue("monthsPaid", Number(e.target.value))} placeholder="Paid" />
                          <p>Remaining Months: {computedRemainingMonths}</p>
                          <p>Monthly Payment: {formatCurrencySymbol(Number(computedMonthlyPayment.toFixed(2)), currencyCode)}</p>
                          <p>Remaining Balance: {formatCurrencySymbol(Number(computedRemainingBalance.toFixed(2)), currencyCode)}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}

              {(formError || Object.keys(expenseForm.formState.errors).length > 0) && (
                <p className="text-sm text-[#fb7185]">{formError || Object.values(expenseForm.formState.errors)[0]?.message?.toString()}</p>
              )}

              <Button
                className="w-full"
                onClick={expenseForm.handleSubmit((values) => {
                  setFormError("");
                  addExpenseMutation.mutate(values);
                })}
              >
                Save
              </Button>
            </>
          )}

          {tab === "history" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Card className="bg-[#1d212c]"><CardContent className="p-3"><p className="text-xs text-[#a1a8b3]">Total Expenses</p><p>{formatCurrencySymbol(totals.all, currencyCode)}</p></CardContent></Card>
                <Card className="bg-[#1d212c]"><CardContent className="p-3"><p className="text-xs text-[#a1a8b3]">Total This Month</p><p>{formatCurrencySymbol(currentMonthTotals.all, currencyCode)}</p></CardContent></Card>
                <Card className="bg-[#122239]"><CardContent className="p-3"><p className="text-xs text-[#a1a8b3]">Total Today</p><p className="text-[#60a5fa]">{formatCurrencySymbol(currentPeriodTotals.daily, currencyCode)}</p></CardContent></Card>
                <Card className="bg-[#1b2338]"><CardContent className="p-3"><p className="text-xs text-[#a1a8b3]">Total This Week</p><p className="text-[#93c5fd]">{formatCurrencySymbol(currentPeriodTotals.weekly, currencyCode)}</p></CardContent></Card>
                <Card className="bg-[#11261b]"><CardContent className="p-3"><p className="text-xs text-[#a1a8b3]">Cash Expenses</p><p className="text-[#22c55e]">{formatCurrencySymbol(totals.cash, currencyCode)}</p></CardContent></Card>
                <Card className="bg-[#24172f]"><CardContent className="p-3"><p className="text-xs text-[#a1a8b3]">Credit This Month</p><p className="text-[#a855f7]">{formatCurrencySymbol(currentMonthTotals.credit, currencyCode)}</p></CardContent></Card>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={historyCardFilter}
                  onValueChange={(value) => {
                    setHistoryCardFilter(value);
                    setHistoryPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Cards" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HISTORY_CARD_FILTER_ALL}>All Cards</SelectItem>
                    <SelectItem value={HISTORY_CARD_FILTER_CASH}>Cash</SelectItem>
                    {cards.map((card) => (
                      <SelectItem key={card.id} value={card.id}>
                        {card.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={historyMonthFilter}
                  onValueChange={(value) => {
                    setHistoryMonthFilter(value);
                    setHistoryPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Months" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HISTORY_MONTH_FILTER_ALL}>All Months</SelectItem>
                    {historyMonthOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Card>
                <CardContent className="space-y-3 p-4">
                  {paginatedExpenses.map((item) => {
                    const cardName = cards.find((card) => card.id === item.card_id)?.name;
                    const isEditing = editingExpenseId === item.id;
                    return (
                      <div key={item.id} className="rounded-xl border border-[#2a2f3a] bg-[#1d212c] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            {isEditing ? (
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <p className="text-xs text-[#a1a8b3]">Description</p>
                                  <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description" />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs text-[#a1a8b3]">Date</p>
                                <Popover open={isEditDatePickerOpen} onOpenChange={setIsEditDatePickerOpen}>
                                  <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start gap-2 text-left font-normal text-[#a1a8b3]">
                                      <CalendarDays className="h-4 w-4 text-[#7d8596]" />
                                      {editingDate ? formatInputDate(editingDate) : "Pick a date"}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent align="start" className="w-auto p-0">
                                    <Calendar
                                      mode="single"
                                      selected={editingDate ?? undefined}
                                      onSelect={(date) => {
                                        if (!date) return;
                                        setEditDate(formatInputDate(date));
                                        setIsEditDatePickerOpen(false);
                                      }}
                                    />
                                  </PopoverContent>
                                </Popover>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs text-[#a1a8b3]">Amount</p>
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={editAmountDisplay}
                                    onChange={(e) => setEditAmountDisplay(formatAmountDisplay(e.target.value))}
                                    placeholder="Amount"
                                  />
                                </div>
                                {item.payment_type === "credit" ? (
                                  <div className="space-y-1">
                                    <p className="text-xs text-[#a1a8b3]">Card</p>
                                    <Select value={editCardId || undefined} onValueChange={setEditCardId}>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select Card" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {cards.map((card) => (
                                          <SelectItem key={card.id} value={card.id}>{card.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : null}
                                {item.payment_type === "credit" ? (
                                  <div className="flex items-center gap-2">
                                    <Switch checked={editIsRecurring} onCheckedChange={setEditIsRecurring} />
                                    <span className="text-sm text-[#a1a8b3]">Recurring (monthly)</span>
                                  </div>
                                ) : null}
                                {item.is_installment && !editIsRecurring ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <p className="text-xs text-[#a1a8b3]">Tenure (months)</p>
                                      <Input
                                        className={SPINNERLESS_NUMBER_INPUT_CLASS}
                                        type="number"
                                        value={editTenureMonths}
                                        onChange={(e) => setEditTenureMonths(e.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs text-[#a1a8b3]">Months Paid</p>
                                      <Input
                                        className={SPINNERLESS_NUMBER_INPUT_CLASS}
                                        type="number"
                                        value={editMonthsPaid}
                                        onChange={(e) => setEditMonthsPaid(e.target.value)}
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <p className="font-semibold">{item.description}</p>
                            )}
                            <p className="text-sm text-[#a1a8b3]">{item.payment_type === "cash" ? "Cash" : cardName ?? "Credit Card"}</p>
                            {item.is_installment && item.installment_tenure_months ? <Badge>{Math.max(item.installment_tenure_months - item.installment_months_paid, 0)} left</Badge> : null}
                            {item.is_recurring ? <Badge>Recurring</Badge> : null}
                          </div>
                          <div className="text-right">
                            {isEditing ? (
                              <div className="space-y-2">
                                <Button size="sm" onClick={() => saveEditingExpense(item)} disabled={updateExpenseMutation.isPending}>Save</Button>
                                <Button size="sm" variant="outline" onClick={cancelEditingExpense}>Cancel</Button>
                              </div>
                            ) : (
                              <>
                                <p className="font-semibold text-[#fb7185]">-{formatCurrencySymbol(Number(item.amount), currencyCode)}</p>
                                <p className="text-sm text-[#a1a8b3]">{formatHistoryDate(item.expense_date)}</p>
                                <div className="mt-1 flex justify-end gap-2">
                                  <button onClick={() => startEditingExpense(item)} className="text-[#a1a8b3]"><Pencil className="h-4 w-4" /></button>
                                  <button onClick={() => deleteExpenseMutation.mutate(item.id)} className="text-[#fb7185]"><Trash2 className="h-4 w-4" /></button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        {isEditing && editError ? <p className="mt-2 text-sm text-[#fb7185]">{editError}</p> : null}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[#a1a8b3]">
                  Page {currentHistoryPage} of {historyTotalPages}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))} disabled={currentHistoryPage === 1}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1))}
                    disabled={currentHistoryPage === historyTotalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}

          {tab === "cards" && (
            <div className="space-y-3">
              <p className="px-1 text-xs text-[#a1a8b3]">GENERAL</p>
              <Card>
                <CardContent className="space-y-3 p-3">
                  <div className="space-y-1">
                    <p className="text-xs text-[#a1a8b3]">Card Name</p>
                    <Input placeholder="Card name" value={cardNameInput} onChange={(e) => cardForm.setValue("name", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-[#a1a8b3]">Cutoff Day</p>
                    <Input className={SPINNERLESS_NUMBER_INPUT_CLASS} type="number" placeholder="1-31" value={String(cardCutoffInput ?? 1)} onChange={(e) => cardForm.setValue("cutoff_day", Number(e.target.value))} />
                  </div>
                </CardContent>
              </Card>
              <Button className="w-full" onClick={cardForm.handleSubmit((values) => addCardMutation.mutate(values))}>Save Card</Button>

              <p className="px-1 text-xs text-[#a1a8b3]">SAVED CARDS</p>
              <Card>
                <CardContent className="p-2">
                  {cards.length === 0 ? (
                    <div className="p-6 text-center text-[#a1a8b3]">No saved cards yet</div>
                  ) : (
                    cards.map((card, index) => (
                      <div key={card.id}>
                        <div className="flex items-center justify-between p-3">
                          {editingCardId === card.id ? (
                            <div className="flex w-full flex-col gap-2">
                              <div className="space-y-1">
                                <p className="text-xs text-[#a1a8b3]">Card Name</p>
                                <Input value={editCardName} onChange={(e) => setEditCardName(e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs text-[#a1a8b3]">Cutoff Day</p>
                                <Input
                                  className={SPINNERLESS_NUMBER_INPUT_CLASS}
                                  type="number"
                                  value={editCardCutoffDay}
                                  onChange={(e) => setEditCardCutoffDay(e.target.value)}
                                />
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => saveEditingCard(card)} disabled={updateCardMutation.isPending}>Save</Button>
                                <Button size="sm" variant="outline" onClick={cancelEditingCard}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div>
                                <p>{card.name}</p>
                                <p className="text-sm text-[#a1a8b3]">Cutoff day {card.cutoff_day}</p>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="outline" size="icon" onClick={() => startEditingCard(card)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="destructive" size="icon" onClick={() => deleteCardMutation.mutate(card.id)}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </>
                          )}
                        </div>
                        {editingCardId === card.id && editError ? <p className="px-3 pb-2 text-sm text-[#fb7185]">{editError}</p> : null}
                        {index !== cards.length - 1 ? <Separator /> : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "balances" && (
            <div className="space-y-3">
              <Card>
                <CardContent className="space-y-3 p-4">
                  <p className="px-1 text-xs text-[#a1a8b3]">MONTH FILTER</p>
                  <Select value={selectedMonthKey} onValueChange={setSelectedMonthKey}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                    {monthChoices.map((choice) => (
                      <SelectItem key={choice.key} value={choice.key}>{choice.label}</SelectItem>
                    ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-2">
                <Card className="rounded-xl border-[#433119] bg-[#2a1f14]">
                  <CardContent className="space-y-1 p-5">
                    <p className="text-sm text-[#e5c38a]">All Cards Total Balance</p>
                    <p className="text-2xl font-bold text-[#fbbf24]">{formatCurrencySymbol(allCardsTotalBalance, currencyCode)}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl border-[#2a2f3a] bg-[#1d212c]">
                  <CardContent className="space-y-1 p-5 cursor-pointer" onClick={() => setBalanceDetailType("installments")}>
                    <p className="text-sm text-[#a1a8b3]">Total Installments</p>
                    <p className="text-2xl font-bold text-[#60a5fa]">{formatCurrencySymbol(totalInstallmentsBalance, currencyCode)}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-xl border-[#2a2f3a] bg-[#1d212c]">
                  <CardContent className="space-y-1 p-5 cursor-pointer" onClick={() => setBalanceDetailType("recurring")}>
                    <p className="text-sm text-[#a1a8b3]">Total Recurring</p>
                    <p className="text-2xl font-bold text-[#34d399]">{formatCurrencySymbol(totalRecurringBalance, currencyCode)}</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="space-y-3 p-4">
                  <p className="px-1 text-xs text-[#a1a8b3]">GENERAL</p>

                  <Card className="rounded-xl bg-[#1d212c]">
                    <CardHeader><CardTitle>Cash</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-[#a1a8b3]">{cashBalance.included.length} transaction{cashBalance.included.length === 1 ? "" : "s"}</p>
                      <p className="text-xl font-semibold text-[#22c55e]">{formatCurrencySymbol(cashBalance.total, currencyCode)}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setExpandedBalanceItems((prev) => ({
                            ...prev,
                            cash: !prev.cash,
                          }))
                        }
                      >
                        {expandedBalanceItems.cash ? "Hide Transactions" : "Show Transactions"}
                      </Button>
                      {expandedBalanceItems.cash ? (
                        <>
                          <Separator />
                          {cashBalance.included.length === 0 ? (
                            <p className="text-sm text-[#a1a8b3]">No cash transactions in this month.</p>
                          ) : (
                            cashBalance.included.map((line) => (
                              <div key={line.id} className="flex justify-between text-sm">
                                <span>{line.label}</span>
                                <span>{formatCurrencySymbol(line.amount, currencyCode)}</span>
                              </div>
                            ))
                          )}
                        </>
                      ) : null}
                    </CardContent>
                  </Card>

                  {monthlyBalances.map(({ card, included, total }) => (
                    <Card key={card.id} className="rounded-xl bg-[#1d212c]">
                      <CardHeader><CardTitle>{card.name}</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        <p className="text-sm text-[#a1a8b3]">Cutoff day: {card.cutoff_day} • {included.length} transaction{included.length === 1 ? "" : "s"}</p>
                        <p className="text-xl font-semibold text-[#fb7185]">{formatCurrencySymbol(total, currencyCode)}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setExpandedBalanceItems((prev) => ({
                              ...prev,
                              [card.id]: !prev[card.id],
                            }))
                          }
                        >
                          {expandedBalanceItems[card.id] ? "Hide Transactions" : "Show Transactions"}
                        </Button>
                        {expandedBalanceItems[card.id] ? (
                          <>
                            <Separator />
                            {included.length === 0 ? (
                              <p className="text-sm text-[#a1a8b3]">No transactions in this billing cycle.</p>
                            ) : (
                              included.map((line) => (
                                <div key={line.id} className="flex justify-between text-sm">
                                  <span>{line.label}</span>
                                  <span>{formatCurrencySymbol(line.amount, currencyCode)}</span>
                                </div>
                              ))
                            )}
                          </>
                        ) : null}
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "analysis" && (
            <div className="space-y-3">
              <Card>
                <CardContent className="space-y-4 p-4">
                  <div>
                    <p className="text-base font-semibold">AI insights</p>
                    <p className="text-sm text-[#a1a8b3]">
                      Generate personalized insights on where your money goes and practical ways to reduce spending.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAnalysisError("");
                        if (analysisTypingTimerRef.current) {
                          window.clearInterval(analysisTypingTimerRef.current);
                          analysisTypingTimerRef.current = null;
                        }
                        setIsTypingAnalysis(false);
                        setSelectedAnalysisId("");
                        setActiveAnalysisPeriod("weekly");
                        analyzeSpendingMutation.mutate("weekly");
                      }}
                      disabled={analyzeSpendingMutation.isPending || !isSunday || hasWeeklyAnalysisForCurrentWeek}
                    >
                      {analyzeSpendingMutation.isPending && activeAnalysisPeriod === "weekly" ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Analyzing weekly...
                        </span>
                      ) : hasWeeklyAnalysisForCurrentWeek ? (
                        "Weekly: already generated"
                      ) : isSunday ? (
                        "Analyze Weekly"
                      ) : (
                        "Weekly: Sunday only"
                      )}
                    </Button>
                    <Select
                      value={analysisHistoryFilter}
                      onValueChange={(value: "__all__" | "weekly" | "monthly") => setAnalysisHistoryFilter(value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANALYSIS_HISTORY_FILTER_ALL}>All Saved</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      setAnalysisError("");
                      if (analysisTypingTimerRef.current) {
                        window.clearInterval(analysisTypingTimerRef.current);
                        analysisTypingTimerRef.current = null;
                      }
                      setIsTypingAnalysis(false);
                      setSelectedAnalysisId("");
                      setActiveAnalysisPeriod("monthly");
                      analyzeSpendingMutation.mutate("monthly");
                    }}
                    disabled={analyzeSpendingMutation.isPending || !isMonthEnd || hasMonthlyAnalysisForCurrentMonth}
                  >
                    {analyzeSpendingMutation.isPending && activeAnalysisPeriod === "monthly" ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyzing monthly...
                      </span>
                    ) : hasMonthlyAnalysisForCurrentMonth ? (
                      "Monthly: already generated"
                    ) : isMonthEnd ? (
                      "Analyze Monthly"
                    ) : (
                      "Monthly: last day only"
                    )}
                  </Button>
                  {analyzeSpendingMutation.isPending ? (
                    <div className="rounded-lg border border-[#2a2f3a] bg-[#111827] p-3">
                      <p className="text-sm text-[#93c5fd]">
                        {activeAnalysisPeriod === "monthly" ? "Building monthly insights..." : "Building weekly insights..."}
                      </p>
                      <p className="mt-1 text-xs text-[#a1a8b3]">Crunching transactions, comparing with previous period, and generating recommendations.</p>
                    </div>
                  ) : null}
                  {analysisError ? <p className="text-sm text-[#fb7185]">{analysisError}</p> : null}
                  {!analysisError ? (
                    <p className="text-xs text-[#a1a8b3]">
                      Weekly analysis runs on Sunday (once per week). Monthly analysis runs on the last day of each month (once per month).
                    </p>
                  ) : null}
                  {analysisSaveError ? <p className="text-sm text-[#f59e0b]">{analysisSaveError}</p> : null}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-4">
                  <p className="text-xs text-[#a1a8b3]">SAVED INSIGHTS</p>
                  {analysisHistoryQuery.isLoading ? (
                    <p className="text-sm text-[#a1a8b3]">Loading saved insights...</p>
                  ) : filteredAnalysisHistory.length === 0 ? (
                    <p className="text-sm text-[#a1a8b3]">No saved insights yet.</p>
                  ) : (
                    filteredAnalysisHistory.slice(0, 8).map((entry) => (
                      <button
                        key={entry.id}
                        className={`w-full rounded-xl border p-3 text-left ${
                          selectedAnalysisId === entry.id ? "border-[#0a84ff] bg-[#0b2b51]" : "border-[#2a2f3a] bg-[#1d212c]"
                        }`}
                        onClick={() => selectSavedAnalysis(entry)}
                      >
                        <p className="text-sm font-semibold">{entry.period === "weekly" ? "Weekly insight" : "Monthly insight"}</p>
                        <p className="text-xs text-[#a1a8b3]">
                          {new Date(entry.created_at).toLocaleString()} {entry.source ? `• ${entry.source}` : ""}
                        </p>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[#a1a8b3]">RESULT</p>
                    {isTypingAnalysis ? <Badge className="bg-[#0b2b51] text-[#93c5fd]">Typing...</Badge> : null}
                  </div>
                  {analyzeSpendingMutation.isPending || (analysisHistoryQuery.isLoading && !analysisResult) ? (
                    <AnalysisResultSkeleton />
                  ) : analysisResult ? (
                    <div className="space-y-3">
                      {parsedAnalysisSections.length > 0 ? (
                        parsedAnalysisSections.map((section, index) => (
                          <div key={`${section.title}-${index}`} className="rounded-xl border border-[#2a2f3a] bg-[#1d212c] p-3">
                            {section.title ? <p className="mb-2 text-sm font-semibold text-[#e5e7eb]">{section.title}</p> : null}
                            {section.paragraphs.map((paragraph, paragraphIndex) => (
                              <p key={`${section.title}-p-${paragraphIndex}`} className="text-sm leading-6 text-[#cbd5e1]">
                                {paragraph}
                              </p>
                            ))}
                            {section.bullets.length > 0 ? (
                              <ul className="mt-2 space-y-1 text-sm text-[#cbd5e1]">
                                {section.bullets.map((bullet, bulletIndex) => (
                                  <li key={`${section.title}-b-${bulletIndex}`} className="flex gap-2">
                                    <span className="mt-[2px] text-[#60a5fa]">•</span>
                                    <span>{bullet}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div className="whitespace-pre-wrap text-sm leading-6 text-[#e5e7eb]">{displayedAnalysis}</div>
                      )}
                      {isTypingAnalysis ? (
                        <p className="text-xs text-[#93c5fd]">Generating insights...</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-[#a1a8b3]">No analysis yet. Tap the button above to generate insights.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40">
          <div className="mx-auto w-full max-w-2xl px-5 pb-3 pt-2">
            <div className="rounded-full border border-[#2a2f3a] bg-[#171a23] px-4 py-2">
              <div className="flex items-center justify-between">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.key;
                  return (
                    <button key={item.key} onClick={() => setTab(item.key)} className={`rounded-full p-2 ${active ? "bg-[#0b2b51]" : ""}`}>
                      <Icon className={`h-6 w-6 ${active ? "text-[#0a84ff]" : "text-[#a1a8b3]"}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 bg-[#05070d] px-5 py-3">
          <div className="mx-auto max-w-2xl">
            <div className="mb-4 flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={() => setShowSettings(false)}><ChevronLeft className="h-5 w-5" /></Button>
              <h2 className="text-lg font-semibold">Settings</h2>
              <div className="h-10 w-10" />
            </div>
            <div className="space-y-4">
              <p className="px-1 text-xs text-[#a1a8b3]">ACCOUNT</p>
              <Card>
                <CardContent className="space-y-2 p-4 text-sm">
                  <p>Name: <span className="text-[#a1a8b3]">{profileName || "Not set"}</span></p>
                  <p>Email: <span className="text-[#a1a8b3]">{profileEmail || "No email"}</span></p>
                  <p>Provider: <span className="text-[#a1a8b3]">{profileProvider ? profileProvider.toUpperCase() : "Unknown"}</span></p>
                  <p>User ID: <span className="break-all text-[#a1a8b3]">{profileUserId || "Unavailable"}</span></p>
                </CardContent>
              </Card>

              <p className="px-1 text-xs text-[#a1a8b3]">GENERAL</p>
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <span>Currency</span>
                  <div className="flex gap-2">
                    <Button variant="outline" className={currencyCode === "USD" ? "border-[#0a84ff] bg-[#0b2b51]" : ""} onClick={() => setCurrencyCode("USD")}>USD</Button>
                    <Button variant="outline" className={currencyCode === "PHP" ? "border-[#0a84ff] bg-[#0b2b51]" : ""} onClick={() => setCurrencyCode("PHP")}>PHP</Button>
                  </div>
                </CardContent>
              </Card>

              <Button variant="destructive" className="w-full" onClick={handleSignOut}>Sign Out</Button>
            </div>
          </div>
        </div>
      )}

      {balanceDetailType && (
        <div className="fixed inset-0 z-50 bg-[#05070d]/95 px-5 py-4">
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{balanceDetailType === "installments" ? "Installments" : "Recurring"} Details</h2>
              <Button
                variant="outline"
                onClick={() => {
                  setBalanceDetailType(null);
                  setEditingExpenseId(null);
                  setEditError("");
                }}
              >
                Close
              </Button>
            </div>
            <Card>
              <CardContent className="space-y-3 p-4">
                {(balanceDetailType === "installments" ? installmentBalanceItems : recurringBalanceItems).length === 0 ? (
                  <p className="text-sm text-[#a1a8b3]">No items found for this month.</p>
                ) : (
                  (balanceDetailType === "installments" ? installmentBalanceItems : recurringBalanceItems).map((entry) => {
                    const item = entry.expense;
                    const isEditing = editingExpenseId === item.id;
                    const cardName = cards.find((card) => card.id === item.card_id)?.name ?? "Credit Card";
                    return (
                      <div key={entry.id} className="rounded-xl border border-[#2a2f3a] bg-[#1d212c] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            {isEditing ? (
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <p className="text-xs text-[#a1a8b3]">Description</p>
                                  <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs text-[#a1a8b3]">Amount</p>
                                  <Input type="text" inputMode="decimal" value={editAmountDisplay} onChange={(e) => setEditAmountDisplay(formatAmountDisplay(e.target.value))} />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs text-[#a1a8b3]">Card</p>
                                  <Select value={editCardId || undefined} onValueChange={setEditCardId}>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select Card" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {cards.map((card) => (
                                        <SelectItem key={card.id} value={card.id}>
                                          {card.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {item.is_installment && !editIsRecurring ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <p className="text-xs text-[#a1a8b3]">Tenure (months)</p>
                                      <Input className={SPINNERLESS_NUMBER_INPUT_CLASS} type="number" value={editTenureMonths} onChange={(e) => setEditTenureMonths(e.target.value)} />
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs text-[#a1a8b3]">Months Paid</p>
                                      <Input className={SPINNERLESS_NUMBER_INPUT_CLASS} type="number" value={editMonthsPaid} onChange={(e) => setEditMonthsPaid(e.target.value)} />
                                    </div>
                                  </div>
                                ) : null}
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => saveEditingExpense(item)} disabled={updateExpenseMutation.isPending}>
                                    Save
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={cancelEditingExpense}>
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="font-semibold">{item.description}</p>
                                <p className="text-sm text-[#a1a8b3]">{cardName}</p>
                                <p className="text-sm text-[#a1a8b3]">{entry.label}</p>
                              </>
                            )}
                          </div>
                          {!isEditing ? (
                            <div className="text-right">
                              <p className="font-semibold text-[#fb7185]">-{formatCurrencySymbol(entry.amount, currencyCode)}</p>
                              <div className="mt-1 flex justify-end gap-2">
                                <button onClick={() => startEditingExpense(item)} className="text-[#a1a8b3]">
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button onClick={() => deleteExpenseMutation.mutate(item.id)} className="text-[#fb7185]">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                        {isEditing && editError ? <p className="mt-2 text-sm text-[#fb7185]">{editError}</p> : null}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
