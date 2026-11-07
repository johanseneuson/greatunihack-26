// Types mirroring the FastAPI backend (backend/app). Platform-neutral: reusable by the Expo app.

export type IncomeType = 'salary' | 'irregular' | 'student' | 'benefits' | 'mixed'
export type Severity = 'critical' | 'warning' | 'info' | 'positive'

export interface User {
  id: number
  name: string
  email: string | null
  income_type: IncomeType
  declared_monthly_income: number | null
  income_day: number | null
  housing: 'rent' | 'mortgage' | 'family' | 'other' | null
  household_size: number
  dependents: number
  current_balance: number | null
  savings_buffer_target: number | null
  challenges: string[]
  notes: string | null
}

export interface Account { id: number; name: string; kind: string; provider: string; balance: number; transactions: number }
export interface Goal { id: number; name: string; target_amount: number; target_date: string | null; saved_amount: number }

export interface Overview {
  user: Pick<User, 'id' | 'name' | 'income_type' | 'housing' | 'household_size' | 'dependents' | 'challenges'>
  as_of: string
  history_days: number
  transactions: number
  balance: number
  balance_source: 'profile' | 'transactions'
  monthly_income: number
  income_source: 'detected' | 'declared' | 'average' | 'none'
  essential_monthly: number
  buffer_target: number
  currency_symbol: string
}

export interface Resilience {
  score: number
  label: 'Thriving' | 'Steady' | 'Stretched' | 'At risk'
  components: Record<string, number>
  savings_rate: number
  emergency_fund_months: number
  spending_volatility: number
  next_best_step: string
}

export interface Snapshot { date: string; p10: number; p50: number; p90: number; prob_negative: number }

export interface ForecastSummary {
  start_balance: number
  horizon_days: number
  end: Snapshot
  lowest_point: { date: string; p50: number; p10: number }
  prob_overdraft: Record<string, number>
  prob_below_buffer: Record<string, number>
  first_risk_date: string | null
  expected_income: number
  expected_spending: number
  prob_unexpected_expense_90d: number
  typical_unexpected_expense: number
  buffer_target: number
}

export interface DailyPoint { date: string; p10: number; p50: number; p90: number; prob_negative: number; expected_out: number; expected_in: number }
export interface ScheduledEvent {
  date: string; name: string; category: string; amount: number
  kind: 'income' | 'bill' | 'one_off'; series_id: string | null; period_days: number | null
}
export interface ForecastMonth {
  month: string; days: number; expected_in: number; expected_out: number; expected_net: number
  end_balance_p10: number; end_balance_p50: number; end_balance_p90: number
}
export interface Forecast { summary: ForecastSummary; daily: DailyPoint[]; monthly?: ForecastMonth[]; scheduled?: ScheduledEvent[]; upcoming?: ScheduledEvent[] }

export interface WaveWeek { week_start: string; outflow: number; baseline: number; is_wave: boolean; kind: 'history' | 'forecast'; p90?: number }
export interface PastWave {
  start: string; end: string; weeks: number; total_spent: number; excess_over_normal: number; peak_week: string
  drivers: { category: string; excess: number }[]
}
export interface UpcomingWave {
  start: string; end: string; expected_spend: number; expected_variable_spend: number; high_estimate: number
  excess_over_normal: number; bills: { date: string; name: string; amount: number }[]; reasons: string[]
}
export interface MonthOutlook {
  month: string; expected_variable_spend: number; high_estimate: number; regular_bills: number
  normal_variable_spend: number; excess_over_normal: number; is_wave: boolean; reasons: string[]
}
export interface Waves {
  measure: string; measure_note?: string; baseline_weekly: number; series: WaveWeek[]
  past_waves: PastWave[]; upcoming_waves: UpcomingWave[]; monthly_outlook?: MonthOutlook[]
  upcoming_wave_months?: MonthOutlook[]; seasonal_peaks: { month: string; factor: number; above_average_pct: number }[]
}

export interface Warning {
  id: string; kind: string; severity: Severity; title: string; message: string
  action: string | null; upside: string | null
  amount?: number; date?: string; probability?: number; probability_with_budget?: number | null; category?: string
}

export interface Recurring {
  id: string; name: string; category: string; group: string; direction: 'in' | 'out'; period: string
  amount: number; monthly_equivalent: number; occurrences: number; last_date: string; next_date: string
  active: boolean; confidence: number
}

export interface BudgetCategory {
  category: string; group: string; avg_monthly: number; suggested_limit: number; change: number
  spent_this_month: number; remaining: number; status: 'over' | 'watch' | 'on_track'
}
export interface Split { needs: number | null; wants: number | null; savings: number | null }
export interface Budget {
  monthly_income: number; income_source: string; target_savings_rate: number; current_savings_rate: number; why: string
  totals: {
    essentials: number; discretionary_now: number; discretionary_suggested: number; savings_suggested: number
    split_now: Split; split_suggested: Split
  }
  categories: BudgetCategory[]
  safe_to_spend: {
    today: number; max_without_overdraft_risk: number; flexible_budget_left_this_month: number; until_payday: number
    next_payday: string; days_to_payday: number; bills_before_payday: number; buffer_kept: number
  }
  subscriptions: { items: Recurring[]; monthly_total: number }
}

export interface TimeSnapshot extends Snapshot { months_ahead: number; change_vs_today: number; headline: string }
export interface GoalTimeline {
  id: number; name: string; target_amount: number; saved_amount: number; target_date: string | null
  likely_date: string | null; cautious_date: string | null; on_track: boolean | null; monthly_needed: number | null; message: string
}
export interface SmartMove {
  title: string; category: string; change_pct: number; monthly_saving: number; balance_gain_6m: number
  overdraft_risk_change_90d: number; message: string; adjustment: Adjustment
}
export interface TimeTravel {
  today: { date: string; balance: number }
  snapshots: TimeSnapshot[]; goals: GoalTimeline[]; monthly: ForecastMonth[]; smart_moves: SmartMove[]
}

export interface MonthCashflow { month: string; income: number; spending: number; essential: number; discretionary: number; net: number; partial: boolean }
export interface CategorySpend {
  category: string; group: string; amount: number; monthly_avg: number; share: number
  change_vs_previous_pct: number | null; transactions: number
}

export interface Dashboard {
  overview: Overview
  empty?: boolean
  resilience: Resilience
  forecast: { summary: ForecastSummary; daily: DailyPoint[]; upcoming: ScheduledEvent[] }
  waves: Waves
  warnings: Warning[]
  budget: Budget
  time_travel: TimeTravel
  history: { monthly: MonthCashflow[]; categories_90d: CategorySpend[] }
}

export interface Transaction {
  id: number; account_id: number; date: string; description: string; amount: number
  category: string; raw_category: string | null; is_transfer: boolean; source: string
}

export type Adjustment =
  | { type: 'category'; category: string; change_pct: number }
  | { type: 'income'; change_pct: number }
  | { type: 'one_off'; amount: number; date: string; label?: string }
  | { type: 'new_recurring'; amount: number; day_of_month?: number; label?: string }
  | { type: 'cancel_recurring'; series_id: string }

export interface ScenarioResult {
  baseline: ForecastSummary; scenario: ForecastSummary
  difference_at: Record<string, number>; overdraft_risk_change_90d: number
  scenario_snapshots: TimeSnapshot[]; scenario_monthly: ForecastMonth[]
}

export interface CoachReply {
  source: 'ai' | 'rules'; model?: string | null
  headline: string; summary: string; future_you: string; watch_out: string[]
  actions: { title: string; detail: string; impact: string }[]; encouragement: string
}

export interface Connector { id: string; name: string; description: string }
export interface ImportResult {
  imported: number; duplicates_skipped: number; accounts: string[]; date_from: string | null; date_to: string | null
  detected_columns?: Record<string, string>; notes?: string[]
}
