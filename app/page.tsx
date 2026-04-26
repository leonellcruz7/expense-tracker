"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChartLine,
  ChevronLeft,
  CreditCard,
  History,
  PlusCircle,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
};

const expenseSchema = z
  .object({
    amount: z.coerce.number().positive(),
    description: z.string().min(1),
    date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
    paymentType: z.enum(["cash", "credit"]),
    cardId: z.string().optional(),
    isInstallment: z.boolean(),
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

const pad2 = (value: number) => String(value).padStart(2, "0");
const formatInputDate = (date: Date) => `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
const formatDbDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return `${pad2(day)}-${pad2(month)}-${year}`.replaceAll("-", "/");
};
const parseInputDate = (value: string) => {
  const [day, month, year] = value.split("/").map(Number);
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

  const expenseForm = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      amount: 0,
      description: "",
      date: formatInputDate(new Date()),
      paymentType: "cash",
      cardId: "",
      isInstallment: false,
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
          "id,description,amount,currency_code,expense_date,payment_type,card_id,is_installment,installment_tenure_months,installment_monthly_amount,installment_months_paid",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ExpenseType[];
    },
  });

  const cards = cardsQuery.data ?? EMPTY_CARDS;
  const expenses = expensesQuery.data ?? EMPTY_EXPENSES;

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
        tenureMonths: 12,
        monthsPaid: 0,
      });
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

  const totals = useMemo(() => {
    const cash = expenses.filter((item) => item.payment_type === "cash").reduce((sum, item) => sum + Number(item.amount), 0);
    const credit = expenses.filter((item) => item.payment_type === "credit").reduce((sum, item) => sum + Number(item.amount), 0);
    return { cash, credit, all: cash + credit };
  }, [expenses]);

  const monthlyBalances = useMemo(() => {
    return cards.map((card) => {
      const included: { id: string; label: string; amount: number }[] = [];
      expenses
        .filter((item) => item.payment_type === "credit" && item.card_id === card.id)
        .forEach((item) => {
          const parsedDate = parseInputDate(formatDbDate(item.expense_date));
          if (!parsedDate) return;
          const baseMonthKey = getStatementMonthKey(parsedDate, card.cutoff_day);
          if (!item.is_installment || !item.installment_tenure_months || !item.installment_monthly_amount) {
            if (baseMonthKey === selectedMonthKey) {
              included.push({
                id: item.id,
                label: `${formatDbDate(item.expense_date)} - ${item.description}`,
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
                label: `${formatDbDate(item.expense_date)} - ${item.description} ${idx + 1}/${item.installment_tenure_months}`,
                amount: Number(item.installment_monthly_amount),
              });
            }
          }
        });

      return { card, included, total: included.reduce((sum, line) => sum + line.amount, 0) };
    });
  }, [cards, expenses, selectedMonthKey]);

  const handleLogin = async () => {
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
    if (error) setAuthError(error.message);
  };

  const handleSignup = async () => {
    if (signupPassword !== signupConfirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }
    setAuthError("");
    const { error } = await supabase.auth.signUp({
      email: signupEmail.trim(),
      password: signupPassword,
      options: { data: { full_name: signupName.trim() } },
    });
    if (error) setAuthError(error.message);
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
  ];

  const pageTitles: Record<TabKey, string> = {
    add: "Add Expense",
    history: "Expense History",
    cards: "Credit Cards",
    balances: "Balances",
  };

  const paymentType = useWatch({ control: expenseForm.control, name: "paymentType" });
  const isInstallment = useWatch({ control: expenseForm.control, name: "isInstallment" });
  const amountInput = useWatch({ control: expenseForm.control, name: "amount" });
  const dateInput = useWatch({ control: expenseForm.control, name: "date" });
  const descriptionInput = useWatch({ control: expenseForm.control, name: "description" });
  const cardIdInput = useWatch({ control: expenseForm.control, name: "cardId" });
  const tenureInput = useWatch({ control: expenseForm.control, name: "tenureMonths" });
  const paidInput = useWatch({ control: expenseForm.control, name: "monthsPaid" });
  const cardNameInput = useWatch({ control: cardForm.control, name: "name" });
  const cardCutoffInput = useWatch({ control: cardForm.control, name: "cutoff_day" });
  const amount = Number(amountInput || 0);
  const tenure = Number(tenureInput || 0);
  const paid = Number(paidInput || 0);
  const computedMonthlyPayment = tenure > 0 ? amount / tenure : 0;
  const computedRemainingBalance = Math.max(amount - paid * computedMonthlyPayment, 0);
  const computedRemainingMonths = Math.max(tenure - paid, 0);

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
            <Button className="w-full bg-[#0a84ff]" onClick={authScreen === "login" ? handleLogin : handleSignup}>{authScreen === "login" ? "Login" : "Create Account"}</Button>
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

        <div className="flex-1 space-y-4 pb-4">
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
                    <Input className="h-16 text-right text-5xl font-bold text-[#ff4d4f]" value={String(amountInput ?? 0)} onChange={(e) => expenseForm.setValue("amount", Number(e.target.value || 0))} />
                  </div>
                </CardContent>
              </Card>

              <p className="px-1 text-xs text-[#a1a8b3]">GENERAL</p>
              <Card>
                <CardContent className="space-y-3 p-3">
                  <Input value={dateInput} onChange={(e) => expenseForm.setValue("date", e.target.value)} placeholder="DD/MM/YYYY" />
                  <Input value={descriptionInput} onChange={(e) => expenseForm.setValue("description", e.target.value)} placeholder="e.g. Groceries" />
                  {paymentType === "credit" && (
                    <select className="h-10 w-full rounded-md bg-[#171a23] px-3 text-sm text-[#a1a8b3]" value={cardIdInput ?? ""} onChange={(e) => expenseForm.setValue("cardId", e.target.value)}>
                      <option value="">Select Card</option>
                      {cards.map((card) => (
                        <option key={card.id} value={card.id}>{card.name}</option>
                      ))}
                    </select>
                  )}
                </CardContent>
              </Card>

              {paymentType === "credit" && (
                <>
                  <p className="px-1 text-xs text-[#a1a8b3]">MORE DETAIL</p>
                  <Card>
                    <CardContent className="space-y-3 p-3">
                      <div className="flex items-center gap-2"><Switch checked={isInstallment} onCheckedChange={(value) => expenseForm.setValue("isInstallment", value)} /><span>Installment</span></div>
                      {isInstallment && (
                        <div className="space-y-3 text-sm text-[#a1a8b3]">
                          <Input type="number" value={String(tenureInput ?? 12)} onChange={(e) => expenseForm.setValue("tenureMonths", Number(e.target.value))} placeholder="Tenure" />
                          <Input type="number" value={String(paidInput ?? 0)} onChange={(e) => expenseForm.setValue("monthsPaid", Number(e.target.value))} placeholder="Paid" />
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
                <Card className="bg-[#11261b]"><CardContent className="p-3"><p className="text-xs text-[#a1a8b3]">Cash Expenses</p><p className="text-[#22c55e]">{formatCurrencySymbol(totals.cash, currencyCode)}</p></CardContent></Card>
                <Card className="bg-[#24172f]"><CardContent className="p-3"><p className="text-xs text-[#a1a8b3]">Credit Expenses</p><p className="text-[#a855f7]">{formatCurrencySymbol(totals.credit, currencyCode)}</p></CardContent></Card>
              </div>

              <Card>
                <CardContent className="space-y-3 p-4">
                  {expenses.map((item) => {
                    const cardName = cards.find((card) => card.id === item.card_id)?.name;
                    return (
                      <div key={item.id} className="rounded-xl border border-[#2a2f3a] bg-[#1d212c] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <p className="font-semibold">{item.description}</p>
                            <p className="text-sm text-[#a1a8b3]">{item.payment_type === "cash" ? "Cash" : cardName ?? "Credit Card"}</p>
                            {item.is_installment && item.installment_tenure_months ? <Badge>{Math.max(item.installment_tenure_months - item.installment_months_paid, 0)} left</Badge> : null}
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-[#fb7185]">-{formatCurrencySymbol(Number(item.amount), currencyCode)}</p>
                            <p className="text-sm text-[#a1a8b3]">{formatDbDate(item.expense_date)}</p>
                            <button onClick={() => deleteExpenseMutation.mutate(item.id)} className="mt-1 text-[#fb7185]"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "cards" && (
            <div className="space-y-3">
              <p className="px-1 text-xs text-[#a1a8b3]">GENERAL</p>
              <Card>
                <CardContent className="space-y-3 p-3">
                  <Input placeholder="Card name" value={cardNameInput} onChange={(e) => cardForm.setValue("name", e.target.value)} />
                  <Input type="number" placeholder="Cutoff Day" value={String(cardCutoffInput ?? 1)} onChange={(e) => cardForm.setValue("cutoff_day", Number(e.target.value))} />
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
                          <div><p>{card.name}</p><p className="text-sm text-[#a1a8b3]">Cutoff day {card.cutoff_day}</p></div>
                          <Button variant="destructive" size="icon" onClick={() => deleteCardMutation.mutate(card.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                        {index !== cards.length - 1 ? <Separator /> : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "balances" && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="px-1 text-xs text-[#a1a8b3]">GENERAL</p>
                <select className="h-10 w-full rounded-md bg-[#171a23] px-3 text-sm text-[#a1a8b3]" value={selectedMonthKey} onChange={(e) => setSelectedMonthKey(e.target.value)}>
                  {monthChoices.map((choice) => (
                    <option key={choice.key} value={choice.key}>{choice.label}</option>
                  ))}
                </select>

                {monthlyBalances.map(({ card, included, total }) => (
                  <Card key={card.id} className="rounded-xl bg-[#1d212c]">
                    <CardHeader><CardTitle>{card.name}</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-[#a1a8b3]">Cutoff day: {card.cutoff_day} • {included.length} transaction{included.length === 1 ? "" : "s"}</p>
                      <p className="text-xl font-semibold text-[#fb7185]">{formatCurrencySymbol(total, currencyCode)}</p>
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
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

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
    </div>
  );
}
