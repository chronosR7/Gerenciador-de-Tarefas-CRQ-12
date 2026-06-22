import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Activity, ActivityType, ModalType, Status } from './types';
import { supabase } from './lib/supabaseClient';
import Login from './Login';

type ThemeMode = 'light' | 'dark';
type DashboardActivity = Activity & {
  notes?: string | null;
  assignee?: string | null;
  owner?: string | null;
  user_name?: string | null;
  usuario?: string | null;
  criticidade?: string | null;
};
type PriorityLevel = 'Crítica' | 'Alta' | 'Média' | 'Normal';
type IconName =
  | 'alert'
  | 'calendar'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'database'
  | 'file'
  | 'flag'
  | 'grid'
  | 'layers'
  | 'list'
  | 'logout'
  | 'moon'
  | 'plus'
  | 'report'
  | 'search'
  | 'settings'
  | 'sun'
  | 'table'
  | 'target'
  | 'user';

interface EnrichedActivity {
  activity: DashboardActivity;
  statusName: string;
  dueDate: Date | null;
  daysUntilDue: number | null;
  isCompleted: boolean;
  isOverdue: boolean;
  isDueToday: boolean;
  priority: PriorityLevel;
  category: string;
  domain: string;
  responsible: string;
}

const THEME_STORAGE_KEY = 'crq-dashboard-theme';
const CRQ_LOGO_SRC = '/crq12-logo.jpg';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;
const ReportCharts = React.lazy(() => import('./ReportCharts'));

const normalizeText = (value?: string | null) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const toDateOnly = (value?: string | null) => {
  if (!value) return null;

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const formatInputDate = (value?: string | Date | null) => {
  const date = value instanceof Date ? value : toDateOnly(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const differenceInCalendarDays = (date: Date, reference: Date) => {
  const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const referenceUtc = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
  return Math.round((dateUtc - referenceUtc) / DAY_IN_MS);
};

const getInitialTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const hasPasswordRecoveryInUrl = () => {
  if (typeof window === 'undefined') return false;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  return hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery';
};

const formatDate = (date: Date | null) => {
  if (!date) return 'Sem prazo';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDeadline = (item: EnrichedActivity) => {
  if (!item.dueDate || item.daysUntilDue === null) return 'Sem prazo definido';
  if (item.daysUntilDue < 0) return `${formatDate(item.dueDate)} · vencida há ${Math.abs(item.daysUntilDue)} dia(s)`;
  if (item.daysUntilDue === 0) return `${formatDate(item.dueDate)} · vence hoje`;
  if (item.daysUntilDue === 1) return `${formatDate(item.dueDate)} · vence amanhã`;
  return `${formatDate(item.dueDate)} · em ${item.daysUntilDue} dias`;
};

const getProcessoSei = (activity: DashboardActivity) =>
  activity.processo_sei || activity.process_sei || '';

const getInternalNotes = (activity: DashboardActivity) =>
  activity.internal_notes || activity.comentarios_internos || activity.notes || '';

const isValidUrl = (value?: string | null) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const isCompletedStatus = (statusName: string) =>
  /conclu|finaliz|feito|encerrad|resolvid/.test(normalizeText(statusName));

const getActivityDate = (activity: DashboardActivity) =>
  toDateOnly(activity.due_date || activity.deadline || activity.prazo || activity.activity_date);

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const parseSpreadsheetDate = (value: unknown) => {
  if (value instanceof Date) return formatInputDate(value);

  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const parsed = new Date(excelEpoch.getTime() + Math.round(value * DAY_IN_MS));
    if (!Number.isNaN(parsed.getTime())) return formatInputDate(parsed);
  }

  const text = String(value ?? '').trim();
  if (!text || normalizeText(text) === 'sem prazo') return null;

  const brDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brDate) {
    const [, day, month, year] = brDate;
    return formatInputDate(new Date(Number(year), Number(month) - 1, Number(day)));
  }

  return formatInputDate(text) || null;
};

const getSpreadsheetValue = (row: Record<string, unknown>, keys: string[]) => {
  const key = keys.find(candidate => Object.prototype.hasOwnProperty.call(row, candidate));
  return key ? row[key] : '';
};

const getResponsible = (activity: DashboardActivity) =>
  activity.responsible ||
  activity.responsavel ||
  activity.assignee ||
  activity.owner ||
  activity.user_name ||
  activity.usuario ||
  '';

const inferDomain = (activity: DashboardActivity, parentName = '') => {
  const source = normalizeText([
    activity.name,
    activity.description,
    activity.difficulties,
    activity.suggestions,
    activity.category,
    activity.categoria,
    parentName
  ].filter(Boolean).join(' '));

  if (/contrato|aditivo|vigencia|fornecedor/.test(source)) return 'Contratos';
  if (/processo sei|sei|processo administrativo/.test(source)) return 'Processos SEI';
  if (/licitacao|licita|pregao|dispensa|inexigibilidade/.test(source)) return 'Licitações';
  if (/documento|oficio|memorando|certidao|declaracao|assinatura/.test(source)) return 'Documentos';
  if (/ti|tecnologia|sistema|rede|servidor|backup|suporte/.test(source)) return 'Rotinas de TI';
  if (/fiscalizacao|fiscal|vistoria|diligencia|notificacao/.test(source)) return 'Fiscalização';
  return '';
};

const inferPriority = (activity: DashboardActivity, statusName: string, daysUntilDue: number | null): PriorityLevel => {
  const explicit = normalizeText(activity.priority || activity.prioridade || activity.criticidade || '');
  const source = normalizeText([
    activity.name,
    activity.description,
    activity.difficulties,
    activity.suggestions,
    statusName
  ].filter(Boolean).join(' '));

  if (/crit|urgent|emergenc|alto risco|alta prioridade/.test(explicit)) return 'Crítica';
  if (/alta|prioritaria|prioritario/.test(explicit)) return 'Alta';
  if (/media|moderada/.test(explicit)) return 'Média';
  if (/baixa|normal/.test(explicit)) return 'Normal';

  if (daysUntilDue !== null && daysUntilDue < 0) return 'Crítica';
  if (/urgente|critico|critica|prioritario|prioritaria|bloqueio|impedimento/.test(source)) return 'Crítica';
  if (activity.difficulties && String(activity.difficulties).trim()) return 'Alta';
  if (daysUntilDue === 0) return 'Alta';
  if (daysUntilDue !== null && daysUntilDue <= 7) return 'Média';
  return 'Normal';
};

const priorityRank: Record<PriorityLevel, number> = {
  'Crítica': 4,
  Alta: 3,
  'Média': 2,
  Normal: 1
};

const priorityPillClass: Record<PriorityLevel, string> = {
  'Crítica': 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
  Alta: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  'Média': 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30',
  Normal: 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
};

const metricToneClass = {
  blue: 'border-sky-200 bg-sky-50/60 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300',
  red: 'border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300',
  amber: 'border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300',
  teal: 'border-teal-200 bg-teal-50/70 text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300',
  emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300',
  violet: 'border-violet-200 bg-violet-50/70 text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300'
};

const Icon: React.FC<{ name: IconName; className?: string }> = ({ name, className = 'h-4 w-4' }) => {
  const paths: Record<IconName, React.ReactNode> = {
    alert: <><path d="M10.3 3.2 1.8 17.4a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><path d="M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" /></>,
    check: <path d="m20 6-11 11-5-5" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></>,
    flag: <><path d="M4 22V4" /><path d="M4 4h13l-1 5 1 5H4" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
    list: <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
    moon: <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    report: <><path d="M3 3v18h18" /><path d="M7 15v-4" /><path d="M12 15V7" /><path d="M17 15v-6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    settings: <><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m4.9 19.1 1.4-1.4" /><path d="m17.7 6.3 1.4-1.4" /></>,
    table: <><path d="M3 5h18" /><path d="M3 12h18" /><path d="M3 19h18" /><path d="M7 5v14" /><path d="M17 5v14" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 22c1.6-4 4.2-6 8-6s6.4 2 8 6" /></>
  };

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
};

const SummaryCard: React.FC<{
  title: string;
  value: number;
  helper: string;
  icon: IconName;
  tone: keyof typeof metricToneClass;
}> = ({ title, value, helper, icon, tone }) => (
  <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/85">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</p>
        <p className="mt-3 text-3xl font-bold tracking-tight text-zinc-950 dark:text-white">{value}</p>
      </div>
      <div className={`rounded-lg border p-2 ${metricToneClass[tone]}`}>
        <Icon name={icon} className="h-5 w-5" />
      </div>
    </div>
    <p className="mt-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{helper}</p>
  </div>
);

const SectionPanel: React.FC<{
  title: string;
  subtitle: string;
  icon: IconName;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, icon, children, action, className = '' }) => (
  <section className={`rounded-lg border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/85 ${className}`}>
    <div className="flex flex-col gap-3 border-b border-zinc-200/80 p-5 sm:flex-row sm:items-start sm:justify-between dark:border-zinc-800">
      <div className="flex gap-3">
        <div className="mt-0.5 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <Icon name={icon} className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-bold text-zinc-950 dark:text-white">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
      </div>
      {action}
    </div>
    <div className="p-5">{children}</div>
  </section>
);

const PriorityBadge: React.FC<{ priority: PriorityLevel }> = ({ priority }) => (
  <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${priorityPillClass[priority]}`}>
    {priority}
  </span>
);

const StatusBadge: React.FC<{ statusName: string; color?: string }> = ({ statusName, color }) => (
  <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color || '#71717a' }} />
    <span className="truncate">{statusName || 'Sem status'}</span>
  </span>
);

const EmptyState: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/60">
    <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">{title}</p>
    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{text}</p>
  </div>
);

const ActivityListItem: React.FC<{
  item: EnrichedActivity;
  statusColor?: string;
  onOpen: () => void;
}> = ({ item, statusColor, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/40 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:border-zinc-800 dark:bg-zinc-950/35 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/5"
  >
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-bold leading-5 text-zinc-950 dark:text-white">{item.activity.name}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{formatDeadline(item)}</span>
          <span className="hidden sm:inline">•</span>
          <span>{item.category}</span>
          {item.responsible && (
            <>
              <span className="hidden sm:inline">•</span>
              <span className="inline-flex items-center gap-1"><Icon name="user" className="h-3 w-3" />{item.responsible}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <PriorityBadge priority={item.priority} />
        <StatusBadge statusName={item.statusName} color={statusColor} />
      </div>
    </div>
  </button>
);

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [modal, setModal] = useState<ModalType>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => hasPasswordRecoveryInUrl());

  const [viewMode, setViewMode] = useState<'card' | 'table'>('table');
  const [expandedMacros, setExpandedMacros] = useState<string[]>([]);

  const [showWelcome, setShowWelcome] = useState(false);
  const [fadeOutWelcome, setFadeOutWelcome] = useState(false);
  const [headerText, setHeaderText] = useState('');
  const typingStarted = useRef(false);
  const fullHeaderText = 'Gerenciador de Tarefas - CRQ XII';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (initialSession) {
        setSession(initialSession);
        if (hasPasswordRecoveryInUrl()) {
          setIsPasswordRecovery(true);
          setShowWelcome(false);
        } else if (!sessionStorage.getItem('welcome_done')) {
          setShowWelcome(true);
        } else {
          setHeaderText(fullHeaderText);
          typingStarted.current = true;
        }
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY' && newSession) {
        setSession(newSession);
        setIsPasswordRecovery(true);
        setShowWelcome(false);
        setFadeOutWelcome(false);
      } else if (event === 'SIGNED_IN' && newSession) {
        setSession(newSession);
        if (!sessionStorage.getItem('welcome_done')) {
          setShowWelcome(true);
          setFadeOutWelcome(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setIsPasswordRecovery(false);
        setActivities([]);
        setStatuses([]);
        sessionStorage.removeItem('welcome_done');
        setShowWelcome(false);
        setHeaderText('');
        typingStarted.current = false;
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (showWelcome && !fadeOutWelcome) {
      const timer = setTimeout(() => setFadeOutWelcome(true), 1800);
      return () => clearTimeout(timer);
    }
    if (fadeOutWelcome && showWelcome) {
      const timer = setTimeout(() => {
        sessionStorage.setItem('welcome_done', 'true');
        setShowWelcome(false);
        if (!typingStarted.current) startTyping();
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [showWelcome, fadeOutWelcome]);

  const startTyping = () => {
    if (typingStarted.current) return;
    typingStarted.current = true;
    let i = 0;
    const interval = setInterval(() => {
      if (i < fullHeaderText.length) {
        setHeaderText(fullHeaderText.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
      }
    }, 45);
  };

  const fetchData = async () => {
    if (!session?.user) return;
    setLoading(true);
    setDataError('');

    try {
      const [statusResult, activityResult] = await Promise.all([
        supabase.from('statuses').select('*').order('name', { ascending: true }),
        supabase.from('activities').select('*').order('created_at', { ascending: false })
      ]);

      if (statusResult.error) throw statusResult.error;
      if (activityResult.error) throw activityResult.error;

      setStatuses(statusResult.data || []);
      setActivities(activityResult.data || []);
    } catch (error: unknown) {
      setDataError(getErrorMessage(error, 'Não foi possível carregar tarefas e status.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) fetchData();
  }, [session]);

  const statusMap = useMemo(() => new Map(statuses.map(s => [s.id, s])), [statuses]);
  const macroActivities = useMemo(() => activities.filter(a => a.type === ActivityType.MACRO), [activities]);

  const getParentName = (activity: DashboardActivity) =>
    activities.find(parent => parent.id === activity.macro_id)?.name || '';

  const getCategory = (activity: DashboardActivity) => {
    const explicitCategory = activity.category || activity.categoria;
    if (explicitCategory) return explicitCategory;
    const parentName = getParentName(activity);
    const domain = inferDomain(activity, parentName);
    if (domain) return domain;
    if (parentName) return parentName;
    return activity.type === ActivityType.MACRO ? 'Projeto institucional' : 'Rotina operacional';
  };

  const enrichedActivities = useMemo<EnrichedActivity[]>(() => {
    const today = new Date();
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return activities.map(activity => {
      const dashboardActivity = activity as DashboardActivity;
      const statusName = statusMap.get(dashboardActivity.status_id)?.name || 'Sem status';
      const dueDate = getActivityDate(dashboardActivity);
      const daysUntilDue = dueDate ? differenceInCalendarDays(dueDate, todayOnly) : null;
      const isCompleted = isCompletedStatus(statusName);
      const parentName = getParentName(dashboardActivity);
      const category = getCategory(dashboardActivity);
      const domain = inferDomain(dashboardActivity, parentName || category);
      const priority = inferPriority(dashboardActivity, statusName, daysUntilDue);

      return {
        activity: dashboardActivity,
        statusName,
        dueDate,
        daysUntilDue,
        isCompleted,
        isOverdue: !isCompleted && ((daysUntilDue !== null && daysUntilDue < 0) || /atrasad|vencid/.test(normalizeText(statusName))),
        isDueToday: !isCompleted && daysUntilDue === 0,
        priority,
        category,
        domain,
        responsible: getResponsible(dashboardActivity)
      };
    });
  }, [activities, statusMap]);

  const filteredEnrichedActivities = useMemo(() => {
    const query = normalizeText(searchTerm);

    return enrichedActivities.filter(item => {
      const activity = item.activity;
      const parentName = getParentName(activity);
      const matchesStatus = filterStatus === 'all' || activity.status_id === filterStatus;
      const matchesSearch = !query || normalizeText([
        activity.name,
        activity.description,
        activity.difficulties,
        activity.suggestions,
        getProcessoSei(activity),
        getInternalNotes(activity),
        item.statusName,
        item.category,
        item.responsible,
        parentName
      ].filter(Boolean).join(' ')).includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [enrichedActivities, searchTerm, filterStatus, activities]);

  const dashboard = useMemo(() => {
    const pending = filteredEnrichedActivities.filter(item => !item.isCompleted);
    const overdue = pending.filter(item => item.isOverdue);
    const dueToday = pending.filter(item => item.isDueToday);
    const nextSevenDays = pending.filter(item => item.daysUntilDue !== null && item.daysUntilDue > 0 && item.daysUntilDue <= 7);
    const completed = filteredEnrichedActivities.filter(item => item.isCompleted);
    const critical = pending.filter(item => item.priority === 'Crítica' || item.priority === 'Alta');

    const sortByRisk = (items: EnrichedActivity[]) => [...items].sort((a, b) => {
      const aDays = a.daysUntilDue ?? 9999;
      const bDays = b.daysUntilDue ?? 9999;
      return (aDays - bDays) || (priorityRank[b.priority] - priorityRank[a.priority]);
    });

    const dailyPriorities = sortByRisk([
      ...overdue,
      ...dueToday,
      ...critical.filter(item => !item.isOverdue && !item.isDueToday)
    ]).filter((item, index, array) => array.findIndex(candidate => candidate.activity.id === item.activity.id) === index).slice(0, 6);

    const importantDeadlines = sortByRisk(pending.filter(item => {
      const closeDeadline = item.daysUntilDue !== null && item.daysUntilDue <= 15;
      const institutionalDeadline = Boolean(item.domain && item.dueDate);
      return closeDeadline || institutionalDeadline;
    })).slice(0, 7);

    const statusOverview = [
      {
        label: 'Não iniciada',
        value: filteredEnrichedActivities.filter(item => /nao iniciad|novo|abert|backlog|pendente/.test(normalizeText(item.statusName))).length,
        color: 'bg-zinc-500'
      },
      {
        label: 'Em andamento',
        value: filteredEnrichedActivities.filter(item => /andamento|execucao|progresso|tratativa/.test(normalizeText(item.statusName))).length,
        color: 'bg-sky-500'
      },
      {
        label: 'Aguardando resposta',
        value: filteredEnrichedActivities.filter(item => /aguardando resposta|resposta|retorno/.test(normalizeText(item.statusName))).length,
        color: 'bg-amber-500'
      },
      {
        label: 'Aguardando documento',
        value: filteredEnrichedActivities.filter(item => /aguardando documento|documento/.test(normalizeText(item.statusName))).length,
        color: 'bg-indigo-500'
      },
      {
        label: 'Aguardando assinatura',
        value: filteredEnrichedActivities.filter(item => /aguardando assinatura|assinatura/.test(normalizeText(item.statusName))).length,
        color: 'bg-violet-500'
      },
      { label: 'Concluída', value: completed.length, color: 'bg-emerald-500' },
      { label: 'Atrasada', value: overdue.length, color: 'bg-rose-500' }
    ];

    return {
      pending,
      overdue,
      dueToday,
      nextSevenDays,
      completed,
      critical,
      dailyPriorities,
      importantDeadlines,
      statusOverview
    };
  }, [filteredEnrichedActivities]);

  const filteredActivities = useMemo(() => {
    return filteredEnrichedActivities.map(item => item.activity);
  }, [filteredEnrichedActivities]);

  const visibleMacroActivities = useMemo(() => {
    const hasFilters = searchTerm.trim() || filterStatus !== 'all';
    if (!hasFilters) return macroActivities;
    return macroActivities.filter(macro =>
      filteredActivities.some(activity => activity.id === macro.id || activity.macro_id === macro.id)
    );
  }, [macroActivities, filteredActivities, searchTerm, filterStatus]);

  const standaloneMicroActivities = useMemo(
    () => filteredActivities.filter(activity => activity.type === ActivityType.MICRO && !activity.macro_id),
    [filteredActivities]
  );

  const getMicroActivities = (macroId: string) =>
    filteredActivities.filter(activity => activity.type === ActivityType.MICRO && activity.macro_id === macroId);

  const getEnrichedItem = (activityId: string) =>
    enrichedActivities.find(item => item.activity.id === activityId);

  const toggleMacro = (macroId: string) =>
    setExpandedMacros(prev => prev.includes(macroId) ? prev.filter(id => id !== macroId) : [...prev, macroId]);

  const addActivity = async (activity: Partial<Activity>) => {
    if (!session?.user) return false;
    const { id: _id, created_at: _createdAt, createdAt: _legacyCreatedAt, ...changes } = activity;
    const { error } = await supabase.from('activities').insert([{
      ...changes,
      name: activity.name?.trim(),
      user_id: session.user.id
    }]);

    if (error) {
      window.alert(`Não foi possível criar o registro: ${error.message}`);
      return false;
    }

    setModal(null);
    await fetchData();
    return true;
  };

  const updateActivity = async (activity: Partial<Activity> & { id: string }) => {
    const { id, user_id: _userId, created_at: _createdAt, createdAt: _legacyCreatedAt, ...changes } = activity;
    const { error } = await supabase.from('activities').update(changes).eq('id', id);

    if (error) {
      window.alert(`Não foi possível atualizar o registro: ${error.message}`);
      return false;
    }

    setModal(null);
    await fetchData();
    return true;
  };

  const deleteActivity = async (activityId: string) => {
    const activity = activities.find(item => item.id === activityId);
    const childCount = activities.filter(item => item.macro_id === activityId).length;
    if (childCount > 0) {
      window.alert(`Este projeto possui ${childCount} tarefa(s) vinculada(s). Remova ou transfira essas tarefas antes de excluir o projeto.`);
      return;
    }

    if (!window.confirm(`Excluir permanentemente “${activity?.name || 'este registro'}”?`)) return;

    const { error } = await supabase.from('activities').delete().eq('id', activityId);
    if (error) {
      window.alert(`Não foi possível excluir o registro: ${error.message}`);
      return;
    }

    setModal(null);
    await fetchData();
  };

  const addStatus = async (name: string, color: string) => {
    const normalizedName = name.trim();
    if (!normalizedName || !session?.user) return false;
    if (statuses.some(status => normalizeText(status.name) === normalizeText(normalizedName))) {
      window.alert('Já existe um status com esse nome.');
      return false;
    }

    const { error } = await supabase.from('statuses').insert([{ name: normalizedName, color, user_id: session.user.id }]);
    if (error) {
      window.alert(`Não foi possível criar o status: ${error.message}`);
      return false;
    }

    await fetchData();
    return true;
  };

  const deleteStatus = async (statusId: string) => {
    const status = statuses.find(item => item.id === statusId);
    const usageCount = activities.filter(activity => activity.status_id === statusId).length;
    if (usageCount > 0) {
      window.alert(`O status “${status?.name || ''}” está em uso por ${usageCount} registro(s) e não pode ser removido.`);
      return false;
    }
    if (statuses.length <= 1) {
      window.alert('Mantenha pelo menos um status cadastrado.');
      return false;
    }
    if (!window.confirm(`Remover o status “${status?.name || ''}”?`)) return false;

    const { error } = await supabase.from('statuses').delete().eq('id', statusId);
    if (error) {
      window.alert(`Não foi possível remover o status: ${error.message}`);
      return false;
    }

    await fetchData();
    return true;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) window.alert(`Não foi possível encerrar a sessão: ${error.message}`);
  };

  const finishPasswordRecovery = () => {
    setIsPasswordRecovery(false);
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    const data = activities.map(a => ({
      'Nível': a.type,
      'Nome': a.name,
      'Pai': activities.find(p => p.id === a.macro_id)?.name || '',
      'Status': statusMap.get(a.status_id)?.name || 'N/A',
      'Data': formatDate(getActivityDate(a as DashboardActivity)),
      'Descrição': a.description || '',
      'Dificuldades': a.difficulties || '',
      'Processo SEI': getProcessoSei(a as DashboardActivity),
      'Comentários internos': getInternalNotes(a as DashboardActivity),
      'Sugestões': a.suggestions || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Database');
    XLSX.writeFile(wb, `Backup_Workspace_${new Date().getFullYear()}.xlsx`);
  };

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const templateData = [{
      'Nível': 'MACRO',
      'Nome da Atividade': 'Projeto X',
      'Vínculo (Projeto Pai)': '',
      'Status': 'Novo',
      'Data': '01/01/2026',
      'Descrição': '...',
      'Dificuldades': '',
      'Processo SEI': '',
      'Comentários internos': '',
      'Sugestões': ''
    }];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
    XLSX.writeFile(wb, 'Modelo_Importacao.xlsx');
  };

  const handleImportData = async (file: File) => {
    if (!file || !session?.user) return false;
    if (!/\.xlsx?$/i.test(file.name)) {
      window.alert('Selecione uma planilha nos formatos .XLSX ou .XLS.');
      return false;
    }
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      window.alert('A planilha excede o limite de 5 MB. Divida a carga em arquivos menores.');
      return false;
    }
    if (!statuses.length) {
      window.alert('Cadastre pelo menos um status antes de importar tarefas.');
      return false;
    }

    setLoading(true);
    let insertedMacroIds: string[] = [];

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
      if (!sheet) throw new Error('A planilha não possui uma aba legível.');

      const spreadsheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
      if (!spreadsheetRows.length) throw new Error('A planilha não contém registros para importar.');
      if (spreadsheetRows.length > MAX_IMPORT_ROWS) {
        throw new Error(`A planilha possui mais de ${MAX_IMPORT_ROWS} linhas. Divida a importação em lotes menores.`);
      }

      const normalizedRows = spreadsheetRows.map((row, index) => {
        const line = index + 2;
        const name = String(getSpreadsheetValue(row, ['Nome da Atividade', 'Nome'])).trim();
        if (!name) throw new Error(`Linha ${line}: o nome da atividade é obrigatório.`);

        const rawLevel = normalizeText(String(getSpreadsheetValue(row, ['Nível', 'Nivel', 'Tipo'])));
        if (rawLevel && rawLevel !== 'macro' && rawLevel !== 'micro') {
          throw new Error(`Linha ${line}: o nível deve ser MACRO ou MICRO.`);
        }
        const type = rawLevel === 'macro' ? ActivityType.MACRO : ActivityType.MICRO;

        const statusLabel = String(getSpreadsheetValue(row, ['Status'])).trim();
        const status = statusLabel
          ? statuses.find(item => normalizeText(item.name) === normalizeText(statusLabel))
          : statuses[0];
        if (!status) throw new Error(`Linha ${line}: o status “${statusLabel}” não está cadastrado.`);

        const rawDate = getSpreadsheetValue(row, ['Data', 'Prazo']);
        const activityDate = parseSpreadsheetDate(rawDate);
        if (String(rawDate ?? '').trim() && normalizeText(String(rawDate)) !== 'sem prazo' && !activityDate) {
          throw new Error(`Linha ${line}: a data informada é inválida.`);
        }

        return {
          line,
          parentName: String(getSpreadsheetValue(row, ['Vínculo (Projeto Pai)', 'Vinculo (Projeto Pai)', 'Pai'])).trim(),
          payload: {
            name,
            type,
            macro_id: null as string | null,
            status_id: status.id,
            user_id: session.user.id,
            description: String(getSpreadsheetValue(row, ['Descrição', 'Descricao'])).trim(),
            difficulties: String(getSpreadsheetValue(row, ['Dificuldades'])).trim(),
            processo_sei: String(getSpreadsheetValue(row, ['Processo SEI', 'Processo Sei', 'SEI'])).trim(),
            internal_notes: String(getSpreadsheetValue(row, ['Comentários internos', 'Comentarios internos', 'Bloco de notas'])).trim(),
            suggestions: String(getSpreadsheetValue(row, ['Sugestões', 'Sugestoes'])).trim(),
            activity_date: activityDate
          }
        };
      });

      const importedMacros = normalizedRows.filter(row => row.payload.type === ActivityType.MACRO);
      const duplicateMacroNames = importedMacros
        .map(row => normalizeText(row.payload.name))
        .filter((name, index, names) => names.indexOf(name) !== index);
      if (duplicateMacroNames.length) throw new Error('A planilha possui projetos MACRO com nomes duplicados.');

      const macroByName = new Map<string, { id: string; name: string }>(
        macroActivities.map(macro => [normalizeText(macro.name), { id: macro.id, name: macro.name }] as const)
      );

      if (importedMacros.length) {
        const { data, error } = await supabase
          .from('activities')
          .insert(importedMacros.map(row => row.payload))
          .select('id, name');
        if (error) throw error;

        insertedMacroIds = (data || []).map(item => item.id);
        (data || []).forEach(item => macroByName.set(normalizeText(item.name), item));
      }

      const importedTasks = normalizedRows
        .filter(row => row.payload.type === ActivityType.MICRO)
        .map(row => {
          const parent = row.parentName ? macroByName.get(normalizeText(row.parentName)) : null;
          if (row.parentName && !parent) {
            throw new Error(`Linha ${row.line}: o projeto pai “${row.parentName}” não foi encontrado.`);
          }
          return { ...row.payload, macro_id: parent?.id || null };
        });

      if (importedTasks.length) {
        const { error } = await supabase.from('activities').insert(importedTasks);
        if (error) throw error;
      }

      window.alert(`${normalizedRows.length} registro(s) importado(s) com sucesso.`);
      setModal(null);
      await fetchData();
      return true;
    } catch (error: unknown) {
      if (insertedMacroIds.length) {
        await supabase.from('activities').delete().in('id', insertedMacroIds);
      }
      window.alert(getErrorMessage(error, 'Não foi possível processar a planilha.'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const generateDocxReport = (start: string, end: string) => {
    let filtered = activities;
    const startDate = toDateOnly(start);
    const endDate = toDateOnly(end);
    if (startDate) filtered = filtered.filter(activity => {
      const activityDate = getActivityDate(activity as DashboardActivity);
      return Boolean(activityDate && activityDate >= startDate);
    });
    if (endDate) filtered = filtered.filter(activity => {
      const activityDate = getActivityDate(activity as DashboardActivity);
      return Boolean(activityDate && activityDate <= endDate);
    });

    const macros = filtered.filter(a => a.type === ActivityType.MACRO);
    const micros = filtered.filter(a => a.type === ActivityType.MICRO);
    const concluded = micros.filter(a => isCompletedStatus(statusMap.get(a.status_id)?.name || ''));
    const ongoing = micros.filter(a => normalizeText(statusMap.get(a.status_id)?.name).includes('andamento'));
    const meetings = micros.filter(a => /reuniao|call|alinhamento/.test(normalizeText(a.name)));
    const blockers = filtered.filter(a => a.difficulties && a.difficulties.trim() !== '');

    const efficiency = Math.round((concluded.length / (micros.length || 1)) * 100);
    const strategyRatio = Math.round((macros.length / (filtered.length || 1)) * 100);

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><style>
        @page WordSection1 { size: 21.0cm 29.7cm; margin: 2.0cm 2.0cm 2.0cm 2.0cm; }
        body { font-family: 'Calibri', 'Arial', sans-serif; color: #222; line-height: 1.5; }
        h1 { color: #1a2b4c; text-align: center; font-size: 20pt; border-bottom: 2px solid #1a2b4c; margin-bottom: 20pt; text-transform: uppercase; }
        h2 { color: #1a2b4c; border-bottom: 1px solid #1a2b4c; font-size: 14pt; margin-top: 25pt; font-weight: bold; }
        h3 { color: #333; font-size: 12pt; margin-top: 15pt; font-weight: bold; }
        .ia-box { background: #f0f4f8; padding: 15pt; border: 1px solid #1a2b4c; margin-top: 30pt; }
        .kpi-table { width: 100%; border-collapse: collapse; margin: 15pt 0; }
        .kpi-table td { border: 1px solid #eee; padding: 8pt; text-align: center; }
        .kpi-label { font-weight: bold; color: #666; font-size: 8pt; display: block; text-transform: uppercase; }
        .kpi-value { font-size: 14pt; font-weight: bold; color: #1a2b4c; }
      </style></head>
      <body><div class="WordSection1">
        <h1>Relatório de Atividades Operacionais</h1>
        <p align="right">Período: ${startDate ? formatDate(startDate) : 'Início'} a ${endDate ? formatDate(endDate) : 'Hoje'}<br>Emissão: ${new Date().toLocaleDateString('pt-BR')}</p>

        <table class="kpi-table">
          <tr>
            <td><span class="kpi-label">Volume Total</span><span class="kpi-value">${filtered.length}</span></td>
            <td><span class="kpi-label">Eficiência</span><span class="kpi-value">${efficiency}%</span></td>
            <td><span class="kpi-label">Reuniões</span><span class="kpi-value">${meetings.length}</span></td>
            <td><span class="kpi-label">Peso Estratégico</span><span class="kpi-value">${strategyRatio}%</span></td>
          </tr>
        </table>

        <h2>1 - LISTA DE PROJETOS MACRO</h2>
        <ul>${macros.length > 0 ? macros.map(m => `<li><strong>${escapeHtml(m.name)}</strong> (Status: ${escapeHtml(statusMap.get(m.status_id)?.name || 'Sem status')})</li>`).join('') : '<li>Nenhum projeto macro registrado.</li>'}</ul>

        <h2>2 - ATIVIDADES SEMANAIS REALIZADAS</h2>
        <h3>2.1 - Atividades Concluídas</h3>
        <ul>${concluded.length > 0 ? concluded.map(c => `<li>${escapeHtml(c.name)}</li>`).join('') : '<li>Nenhuma atividade concluída.</li>'}</ul>

        <h3>2.2 - Reuniões Realizadas</h3>
        <ul>${meetings.length > 0 ? meetings.map(r => `<li>${escapeHtml(r.name)} (Status: ${escapeHtml(statusMap.get(r.status_id)?.name || 'Sem status')})</li>`).join('') : '<li>Nenhuma reunião registrada.</li>'}</ul>

        <h3>2.3 - Atividades em Andamento</h3>
        <ul>${ongoing.length > 0 ? ongoing.map(o => `<li>${escapeHtml(o.name)}</li>`).join('') : '<li>Nenhuma atividade em trânsito.</li>'}</ul>

        <h2>3 - OBSTÁCULOS E DESAFIOS</h2>
        <ul>${blockers.length > 0 ? blockers.map(b => `<li><strong>${escapeHtml(b.name)}:</strong> ${escapeHtml(b.difficulties)}</li>`).join('') : '<li>Operação sem impedimentos reportados.</li>'}</ul>

        <div class="ia-box">
          <h2 style="margin-top:0">Síntese Gerencial Automática</h2>
          <p>O período analisado demonstra uma <strong>eficiência operacional de ${efficiency}%</strong>. ${strategyRatio < 15 ? 'Observa-se um foco excessivo em demandas reativas (micro), sugerindo a necessidade de maior alocação em projetos estruturais.' : 'O equilíbrio entre visão estratégica e execução de tarefas micro demonstra uma gestão saudável do portfólio.'}</p>
          <p><strong>Gargalos Identificados:</strong> ${blockers.length > 0 ? `A presença de ${blockers.length} obstáculos reportados indica a necessidade de intervenção imediata para destravar o fluxo produtivo.` : 'Não foram detectados impedimentos críticos que comprometam o cronograma.'}</p>
        </div>
      </div></body></html>
    `;
    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Relatorio_Executivo_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.doc`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (isPasswordRecovery) {
    return (
      <Login
        theme={theme}
        onThemeChange={setTheme}
        passwordRecovery
        onPasswordRecoveryComplete={finishPasswordRecovery}
      />
    );
  }

  if (!session) return <Login theme={theme} onThemeChange={setTheme} />;

  const renderModal = () => {
    if (!modal) return null;
    const closeModal = () => setModal(null);
    switch (modal.type) {
      case 'ADD_ACTIVITY':
      case 'EDIT_ACTIVITY':
        return <ActivityFormModal modal={modal} onClose={closeModal} statuses={statuses} onSave={(data) => modal.type === 'EDIT_ACTIVITY' ? updateActivity(data as Activity) : addActivity(data)} macroActivities={macroActivities} />;
      case 'VIEW_ACTIVITY':
        return <ActivityDetailModal activity={modal.activity} onClose={closeModal} statuses={statuses} onStatusChange={(id, statusId) => updateActivity({ id, status_id: statusId })} onDelete={() => deleteActivity(modal.activity.id)} onEdit={() => setModal({ type: 'EDIT_ACTIVITY', activity: modal.activity })} />;
      case 'MANAGE_STATUS':
        return <ManageStatusModal onClose={closeModal} statuses={statuses} onAddStatus={addStatus} onDeleteStatus={deleteStatus} />;
      case 'ALL_TASKS':
        return <AllTasksModal onClose={closeModal} items={enrichedActivities} statuses={statuses} onOpenActivity={(activity: DashboardActivity) => setModal({ type: 'VIEW_ACTIVITY', activity })} />;
      case 'REPORT':
        return <ReportModal onClose={closeModal} activities={activities} statuses={statuses} onGenerate={generateDocxReport} theme={theme} />;
      case 'DATA_MANAGEMENT':
        return <DataManagementModal onClose={closeModal} onExport={exportToExcel} onImport={handleImportData} onTemplate={downloadTemplate} />;
      default:
        return null;
    }
  };

  const summaryCards = [
    { title: 'Pendentes', value: dashboard.pending.length, helper: 'Atividades ainda abertas no fluxo.', icon: 'clock' as IconName, tone: 'blue' as const },
    { title: 'Vencidas', value: dashboard.overdue.length, helper: 'Itens que ultrapassaram o prazo.', icon: 'alert' as IconName, tone: 'red' as const },
    { title: 'Vencem hoje', value: dashboard.dueToday.length, helper: 'Foco operacional do expediente.', icon: 'target' as IconName, tone: 'amber' as const },
    { title: 'Próximos 7 dias', value: dashboard.nextSevenDays.length, helper: 'Demandas com vencimento próximo.', icon: 'calendar' as IconName, tone: 'teal' as const },
    { title: 'Concluídas', value: dashboard.completed.length, helper: 'Entregas encerradas no histórico.', icon: 'check' as IconName, tone: 'emerald' as const },
    { title: 'Críticas', value: dashboard.critical.length, helper: 'Prioridade alta ou risco identificado.', icon: 'flag' as IconName, tone: 'violet' as const }
  ];
  const selectedStatusName = filterStatus === 'all' ? '' : (statusMap.get(filterStatus)?.name || 'Status selecionado');
  const hasDashboardFilters = Boolean(searchTerm.trim() || filterStatus !== 'all');
  const clearDashboardFilters = () => {
    setSearchTerm('');
    setFilterStatus('all');
  };

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-zinc-800 transition-colors dark:bg-[#0d1016] dark:text-zinc-200">
      <style>{`
        @keyframes appleReveal { 0% { opacity: 0; transform: scale(0.96) translateY(10px); filter: blur(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); } }
        .animate-apple-reveal { animation: appleReveal 1.1s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #a1a1aa; border-radius: 999px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; }
        select {
          appearance: none;
          background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
          background-repeat: no-repeat;
          background-position: right 0.85rem center;
          background-size: 0.95em;
        }
      `}</style>

      {showWelcome && (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950 transition-opacity duration-1000 ease-in-out ${fadeOutWelcome ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <h1 className="animate-apple-reveal select-none text-center text-3xl font-extrabold uppercase tracking-[0.28em] text-white sm:text-5xl">
            Acesso autorizado
          </h1>
        </div>
      )}

      <div className="relative flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/90 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/85">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <img src={CRQ_LOGO_SRC} alt="CRQ-12" className="h-11 w-11 flex-shrink-0 rounded-full border border-zinc-200 bg-white object-cover p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900" />
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold uppercase tracking-wide text-zinc-950 dark:text-white sm:text-base">
                {headerText}<span className={`text-sky-500 ${headerText === fullHeaderText ? 'hidden' : 'animate-pulse'}`}>|</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Painel institucional de acompanhamento operacional</p>
              </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                title={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
                aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
              >
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-4 w-4" />
              </button>
              <button onClick={() => setModal({ type: 'ALL_TASKS' })} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-sky-800 transition hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20">
                <Icon name="list" className="h-4 w-4" /> Tarefas
              </button>
              <button onClick={() => setModal({ type: 'MANAGE_STATUS' })} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
                <Icon name="settings" className="h-4 w-4" /> Status
              </button>
              <button onClick={() => setModal({ type: 'DATA_MANAGEMENT' })} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
                <Icon name="database" className="h-4 w-4" /> Dados
              </button>
              <button onClick={() => setModal({ type: 'REPORT' })} className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-500">
                <Icon name="report" className="h-4 w-4" /> Relatórios
              </button>
              <button onClick={signOut} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20">
                <Icon name="logout" className="h-4 w-4" /> Sair
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-6 px-4 py-6 sm:px-6 lg:py-8">
          <section className="rounded-lg border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/85">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300">Painel inicial</p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950 dark:text-white sm:text-3xl">Visão executiva das tarefas e prazos</h1>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Acompanhamento consolidado de atividades pessoais e institucionais, com destaque para riscos, prioridades e vencimentos.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative min-w-0 sm:w-72">
                  <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={searchTerm}
                    onChange={event => setSearchTerm(event.target.value)}
                    placeholder="Buscar tarefa, status ou projeto"
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-sky-500/20"
                  />
                </div>
                <select
                  value={filterStatus}
                  onChange={event => setFilterStatus(event.target.value)}
                  className="h-10 rounded-lg border border-zinc-200 bg-white px-3 pr-9 text-sm font-medium text-zinc-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-sky-500/20"
                >
                  <option value="all">Todos os status</option>
                  {statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
                </select>
              </div>
            </div>
            {hasDashboardFilters && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200">
                <span>
                  Filtro aplicado no painel: <strong>{filteredEnrichedActivities.length}</strong> de {enrichedActivities.length} tarefa(s)
                  {selectedStatusName ? <> com status <strong>{selectedStatusName}</strong></> : null}
                  {searchTerm.trim() ? <> contendo <strong>{searchTerm.trim()}</strong></> : null}.
                </span>
                <button type="button" onClick={clearDashboardFilters} className="text-xs font-bold uppercase tracking-wide text-sky-800 transition hover:text-sky-950 dark:text-sky-300 dark:hover:text-sky-100">
                  Limpar filtros
                </button>
              </div>
            )}
          </section>

          {dataError && (
            <div role="alert" className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              <span>{dataError}</span>
              <button type="button" onClick={fetchData} className="text-xs font-bold uppercase tracking-wide text-rose-700 hover:text-rose-950 dark:text-rose-300 dark:hover:text-white">
                Tentar novamente
              </button>
            </div>
          )}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
            {summaryCards.map(card => <SummaryCard key={card.title} {...card} />)}
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
            <div className="space-y-6">
              <SectionPanel
                title="Prioridades do dia"
                subtitle="Itens mais sensíveis por prazo, risco ou prioridade operacional."
                icon="target"
              >
                {loading ? (
                  <EmptyState title="Carregando painel" text="Consultando atividades e status cadastrados." />
                ) : dashboard.dailyPriorities.length ? (
                  <div className="space-y-3">
                    {dashboard.dailyPriorities.map(item => (
                      <ActivityListItem
                        key={item.activity.id}
                        item={item}
                        statusColor={statusMap.get(item.activity.status_id)?.color}
                        onOpen={() => setModal({ type: 'VIEW_ACTIVITY', activity: item.activity })}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Nenhuma prioridade crítica para hoje" text="Não há tarefas vencidas, vencendo hoje ou marcadas como alta prioridade." />
                )}
              </SectionPanel>

              <SectionPanel
                title="Prazos importantes"
                subtitle="Vencimentos próximos ligados a contratos, SEI, documentos, TI, licitações e fiscalização."
                icon="calendar"
              >
                {dashboard.importantDeadlines.length ? (
                  <div className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                    {dashboard.importantDeadlines.map(item => (
                      <button
                        key={item.activity.id}
                        type="button"
                        onClick={() => setModal({ type: 'VIEW_ACTIVITY', activity: item.activity })}
                        className="grid w-full grid-cols-1 gap-3 bg-white p-4 text-left transition hover:bg-zinc-50 dark:bg-zinc-950/30 dark:hover:bg-zinc-900 sm:grid-cols-[1fr_auto]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              {item.domain || item.category}
                            </span>
                            <PriorityBadge priority={item.priority} />
                          </div>
                          <p className="mt-2 text-sm font-bold text-zinc-950 dark:text-white">{item.activity.name}</p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{item.statusName}</p>
                        </div>
                        <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 sm:text-right">
                          {formatDeadline(item)}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Sem vencimentos críticos próximos" text="Nenhuma tarefa aberta foi identificada nas categorias institucionais monitoradas." />
                )}
              </SectionPanel>
            </div>

            <SectionPanel
              title="Pendências por status"
              subtitle="Leitura rápida do volume por etapa administrativa."
              icon="layers"
              className="self-start"
            >
              <div className="space-y-4">
                {dashboard.statusOverview.map(item => {
                  const percentage = filteredEnrichedActivities.length ? Math.min(100, Math.round((item.value / filteredEnrichedActivities.length) * 100)) : 0;
                  return (
                    <div key={item.label}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${item.color}`} />
                          <span className="truncate text-sm font-semibold text-zinc-700 dark:text-zinc-200">{item.label}</span>
                        </div>
                        <span className="text-sm font-bold text-zinc-950 dark:text-white">{item.value}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className={`h-full rounded-full ${item.color}`} style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionPanel>
          </div>

          <section className="rounded-lg border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/85">
            <div className="flex flex-col gap-4 border-b border-zinc-200/80 p-5 lg:flex-row lg:items-center lg:justify-between dark:border-zinc-800">
              <div>
                <h2 className="text-base font-bold text-zinc-950 dark:text-white">Portfólio de atividades</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Projetos macro e tarefas vinculadas, preservando a navegação operacional existente.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-950">
                  <button
                    onClick={() => setViewMode('table')}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${viewMode === 'table' ? 'bg-white text-sky-700 shadow-sm dark:bg-zinc-800 dark:text-sky-300' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                  >
                    <Icon name="table" className="h-4 w-4" /> Grade
                  </button>
                  <button
                    onClick={() => setViewMode('card')}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${viewMode === 'card' ? 'bg-white text-sky-700 shadow-sm dark:bg-zinc-800 dark:text-sky-300' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                  >
                    <Icon name="grid" className="h-4 w-4" /> Painel
                  </button>
                </div>
                <button onClick={() => setModal({ type: 'ADD_ACTIVITY' })} className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-zinc-800 dark:bg-sky-600 dark:hover:bg-sky-500">
                  <Icon name="plus" className="h-4 w-4" /> Nova atividade
                </button>
              </div>
            </div>

            <div className="p-5">
              {viewMode === 'card' ? (
                visibleMacroActivities.length || standaloneMicroActivities.length ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visibleMacroActivities.map(macro => {
                      const micros = getMicroActivities(macro.id);
                      const macroStatus = statusMap.get(macro.status_id);
                      const macroItem = getEnrichedItem(macro.id);
                      return (
                        <div key={macro.id} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/35">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <button onClick={() => setModal({ type: 'VIEW_ACTIVITY', activity: macro })} className="min-w-0 text-left">
                              <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-950 transition hover:text-sky-700 dark:text-white dark:hover:text-sky-300">{macro.name}</h3>
                              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{macroItem ? formatDeadline(macroItem) : 'Projeto macro'}</p>
                            </button>
                            <StatusBadge statusName={macroStatus?.name || 'N/A'} color={macroStatus?.color} />
                          </div>
                          <div className="space-y-2">
                            {micros.length ? micros.map(micro => {
                              const microStatus = statusMap.get(micro.status_id);
                              return (
                                <button key={micro.id} onClick={() => setModal({ type: 'VIEW_ACTIVITY', activity: micro })} className="flex w-full items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-sm transition hover:border-sky-300 hover:bg-sky-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/5">
                                  <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">{micro.name}</span>
                                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: microStatus?.color || '#71717a' }} />
                                </button>
                              );
                            }) : (
                              <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">Sem tarefas vinculadas neste filtro.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {standaloneMicroActivities.map(activity => {
                      const item = getEnrichedItem(activity.id);
                      const status = statusMap.get(activity.status_id);
                      return (
                        <button key={activity.id} type="button" onClick={() => setModal({ type: 'VIEW_ACTIVITY', activity })} className="rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/40 dark:border-zinc-800 dark:bg-zinc-950/35 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tarefa sem projeto</span><h3 className="mt-1 text-sm font-bold text-zinc-950 dark:text-white">{activity.name}</h3></div>
                            <StatusBadge statusName={status?.name || 'N/A'} color={status?.color} />
                          </div>
                          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{item ? formatDeadline(item) : 'Sem prazo'}</p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState title="Nenhuma atividade encontrada" text="A busca ou o filtro atual não retornou projetos ou tarefas." />
                )
              ) : (
                <div className="custom-scrollbar overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-zinc-50 text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                      <tr>
                        <th className="px-5 py-4">Identificação</th>
                        <th className="px-5 py-4">Classe</th>
                        <th className="px-5 py-4">Status</th>
                        <th className="px-5 py-4">Prazo</th>
                        <th className="px-5 py-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-900/60">
                      {visibleMacroActivities.map(macro => {
                        const macroItem = getEnrichedItem(macro.id);
                        const macroStatus = statusMap.get(macro.status_id);
                        const micros = getMicroActivities(macro.id);
                        return (
                          <React.Fragment key={macro.id}>
                            <tr className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                              <td className="px-5 py-4">
                                <button className="flex min-w-0 items-center gap-3 text-left font-bold text-zinc-950 dark:text-white" onClick={() => toggleMacro(macro.id)}>
                                  <Icon name="chevron" className={`h-4 w-4 flex-shrink-0 text-zinc-400 transition ${expandedMacros.includes(macro.id) ? 'rotate-90' : ''}`} />
                                  <span>{macro.name}</span>
                                </button>
                              </td>
                              <td className="px-5 py-4 text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Macro</td>
                              <td className="px-5 py-4"><StatusBadge statusName={macroStatus?.name || 'N/A'} color={macroStatus?.color} /></td>
                              <td className="px-5 py-4 text-sm text-zinc-600 dark:text-zinc-300">{macroItem ? formatDeadline(macroItem) : 'Sem prazo'}</td>
                              <td className="px-5 py-4 text-right"><button onClick={(event) => { event.stopPropagation(); setModal({ type: 'VIEW_ACTIVITY', activity: macro }); }} className="rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide text-sky-700 transition hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10">Ver</button></td>
                            </tr>
                            {expandedMacros.includes(macro.id) && micros.map(micro => {
                              const microItem = getEnrichedItem(micro.id);
                              const microStatus = statusMap.get(micro.status_id);
                              return (
                                <tr key={micro.id} className="bg-zinc-50/60 transition hover:bg-zinc-100/80 dark:bg-zinc-950/35 dark:hover:bg-zinc-800/50">
                                  <td className="px-5 py-3 pl-12 text-zinc-700 dark:text-zinc-200">{micro.name}</td>
                                  <td className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Micro</td>
                                  <td className="px-5 py-3"><StatusBadge statusName={microStatus?.name || 'N/A'} color={microStatus?.color} /></td>
                                  <td className="px-5 py-3 text-sm text-zinc-600 dark:text-zinc-300">{microItem ? formatDeadline(microItem) : 'Sem prazo'}</td>
                                  <td className="px-5 py-3 text-right"><button onClick={() => setModal({ type: 'VIEW_ACTIVITY', activity: micro })} className="rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide text-sky-700 transition hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10">Abrir</button></td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                      {standaloneMicroActivities.map(activity => {
                        const item = getEnrichedItem(activity.id);
                        const status = statusMap.get(activity.status_id);
                        return (
                          <tr key={activity.id} className="bg-zinc-50/60 transition hover:bg-zinc-100/80 dark:bg-zinc-950/35 dark:hover:bg-zinc-800/50">
                            <td className="px-5 py-3 text-zinc-700 dark:text-zinc-200">{activity.name}</td>
                            <td className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Micro</td>
                            <td className="px-5 py-3"><StatusBadge statusName={status?.name || 'N/A'} color={status?.color} /></td>
                            <td className="px-5 py-3 text-sm text-zinc-600 dark:text-zinc-300">{item ? formatDeadline(item) : 'Sem prazo'}</td>
                            <td className="px-5 py-3 text-right"><button type="button" onClick={() => setModal({ type: 'VIEW_ACTIVITY', activity })} className="rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide text-sky-700 transition hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10">Abrir</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!visibleMacroActivities.length && !standaloneMicroActivities.length && (
                    <div className="p-5">
                      <EmptyState title="Nenhum registro encontrado" text="Ajuste a busca ou o filtro de status para ampliar a consulta." />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
          <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-5 py-4 text-sm text-sky-900 shadow-sm dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200">
            Em caso de dúvidas, problemas de acesso ou necessidade de suporte, entre em contato com o Departamento de Tecnologia — TIC-12.
          </div>
        </main>
        {renderModal()}
      </div>
    </div>
  );
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide = false }) => {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
  <div
    className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
  >
    <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Fechar janela" title="Fechar" className="rounded-md px-2 text-2xl font-semibold leading-none text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300">&times;</button>
      </div>
      <div className="custom-scrollbar overflow-y-auto p-6 sm:p-8">{children}</div>
    </div>
  </div>
  );
};

interface ActivityFormModalProps {
  modal: { type: 'ADD_ACTIVITY'; macroId?: string } | { type: 'EDIT_ACTIVITY'; activity: Activity };
  onClose: () => void;
  onSave: (activity: Partial<Activity>) => Promise<boolean>;
  macroActivities: Activity[];
  statuses: Status[];
}

const ActivityFormModal: React.FC<ActivityFormModalProps> = ({ modal, onClose, onSave, macroActivities, statuses }) => {
  const existingActivity = modal.type === 'EDIT_ACTIVITY' ? modal.activity : null;
  const isEdit = Boolean(existingActivity);
  const [name, setName] = useState(existingActivity?.name || '');
  const [type, setType] = useState(existingActivity?.type || ActivityType.MICRO);
  const [macroId, setMacroId] = useState(existingActivity?.macro_id || (modal.type === 'ADD_ACTIVITY' ? modal.macroId || '' : ''));
  const [statusId, setStatusId] = useState(existingActivity?.status_id || statuses[0]?.id || '');
  const [date, setDate] = useState(formatInputDate(existingActivity?.activity_date) || formatInputDate(new Date()));
  const [desc, setDesc] = useState(existingActivity?.description || '');
  const [diff, setDiff] = useState(existingActivity?.difficulties || '');
  const [sugg, setSugg] = useState(existingActivity?.suggestions || '');
  const [processoSei, setProcessoSei] = useState(existingActivity ? getProcessoSei(existingActivity as DashboardActivity) : '');
  const [internalNotes, setInternalNotes] = useState(existingActivity ? getInternalNotes(existingActivity as DashboardActivity) : '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fieldClass = 'mt-1.5 w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:focus:ring-sky-500/20';
  const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400';
  const availableMacros = macroActivities.filter(macro => macro.id !== existingActivity?.id);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!statuses.length || !statusId || !name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    const saved = await onSave({
      ...(existingActivity || {}),
      name: name.trim(),
      type,
      macro_id: type === ActivityType.MICRO ? (macroId || null) : null,
      status_id: statusId,
      activity_date: date,
      description: desc.trim(),
      difficulties: diff.trim(),
      suggestions: sugg.trim(),
      processo_sei: processoSei.trim(),
      internal_notes: internalNotes.trim()
    });
    if (!saved) setIsSubmitting(false);
  };

  return (
    <Modal title={isEdit ? 'Modificar item' : 'Novo registro operacional'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className={labelClass}>Hierarquia</label><select className={`${fieldClass} disabled:cursor-not-allowed disabled:opacity-60`} value={type} disabled={isEdit} title={isEdit ? 'A hierarquia não pode ser alterada depois da criação' : undefined} onChange={event => { const nextType = event.target.value as ActivityType; setType(nextType); if (nextType === ActivityType.MACRO) setMacroId(''); }}><option value={ActivityType.MICRO}>Micro (Tarefa)</option><option value={ActivityType.MACRO}>Macro (Projeto)</option></select></div>
          <div><label className={labelClass}>Status inicial</label><select className={fieldClass} value={statusId} onChange={event => setStatusId(event.target.value)} required disabled={!statuses.length}><option value="" disabled>{statuses.length ? 'Selecione o status' : 'Cadastre um status primeiro'}</option>{statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}</select></div>
        </div>
        {type === ActivityType.MICRO && (<div><label className={labelClass}>Vínculo com projeto</label><select className={fieldClass} value={macroId} onChange={event => setMacroId(event.target.value)}><option value="">Sem projeto vinculado</option>{availableMacros.map(macro => <option key={macro.id} value={macro.id}>{macro.name}</option>)}</select></div>)}
        <div><label className={labelClass}>Título</label><input className={fieldClass} value={name} onChange={event => setName(event.target.value)} required placeholder="Ex: Call de alinhamento" /></div>
        <div><label className={labelClass}>Data base / prazo</label><input type="date" className={fieldClass} value={date} onChange={event => setDate(event.target.value)} required /></div>
        <div><label className={labelClass}>Escopo operacional</label><textarea className={fieldClass} rows={2} value={desc} onChange={event => setDesc(event.target.value)} /></div>
        <div><label className={labelClass}>Processo SEI</label><input className={fieldClass} value={processoSei} onChange={event => setProcessoSei(event.target.value)} placeholder="Cole o link do processo SEI ou informe o número/referência" /></div>
        <div><label className={labelClass}>Gargalos / impedimentos</label><textarea className={fieldClass} rows={2} value={diff} onChange={event => setDiff(event.target.value)} /></div>
        <div><label className={labelClass}>Entregas / resultados</label><textarea className={fieldClass} rows={2} value={sugg} onChange={event => setSugg(event.target.value)} /></div>
        <div><label className={labelClass}>Comentários internos / bloco de notas</label><textarea className={fieldClass} rows={4} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} placeholder="Observações, lembretes, cobranças realizadas ou informações relevantes" /></div>
        <div className="flex justify-end gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-lg px-5 py-2 text-xs font-bold uppercase tracking-wide text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800">Cancelar</button>
          <button type="submit" disabled={isSubmitting || !statuses.length} className="rounded-lg bg-sky-700 px-6 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? 'Salvando...' : 'Salvar registro'}</button>
        </div>
      </form>
    </Modal>
  );
};

const ProcessoSeiDisplay: React.FC<{ activity: DashboardActivity }> = ({ activity }) => {
  const processoSei = getProcessoSei(activity);

  if (!processoSei) {
    return <p className="leading-relaxed text-zinc-500 dark:text-zinc-400">Nenhum processo SEI informado.</p>;
  }

  if (isValidUrl(processoSei)) {
    return (
      <a href={processoSei} target="_blank" rel="noopener noreferrer" className="break-words font-semibold text-sky-700 underline underline-offset-4 transition hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-200">
        {processoSei}
      </a>
    );
  }

  return <p className="break-words leading-relaxed text-zinc-700 dark:text-zinc-300">{processoSei}</p>;
};

interface ActivityDetailModalProps {
  activity: Activity;
  onClose: () => void;
  statuses: Status[];
  onStatusChange: (activityId: string, statusId: string) => Promise<boolean>;
  onDelete: () => void;
  onEdit: () => void;
}

const ActivityDetailModal: React.FC<ActivityDetailModalProps> = ({ activity, onClose, statuses, onStatusChange, onDelete, onEdit }) => {
  const [statusUpdating, setStatusUpdating] = useState(false);
  const currentStatus = statuses.find(status => status.id === activity.status_id);
  const dueDate = getActivityDate(activity as DashboardActivity);

  const handleStatusChange = async (statusId: string) => {
    if (statusId === activity.status_id || statusUpdating) return;
    setStatusUpdating(true);
    const updated = await onStatusChange(activity.id, statusId);
    if (!updated) setStatusUpdating(false);
  };

  return (
  <Modal title="Detalhes da atividade" onClose={onClose}>
    <div className="space-y-6">
      <h3 className="border-b border-zinc-200 pb-4 text-2xl font-bold tracking-tight text-zinc-950 dark:border-zinc-800 dark:text-white">{activity.name}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"><span className="block text-[10px] font-bold uppercase tracking-wide text-zinc-500">Tipo</span><strong className="mt-1 block text-sm text-zinc-900 dark:text-white">{activity.type === ActivityType.MACRO ? 'Projeto macro' : 'Tarefa micro'}</strong></div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"><span className="block text-[10px] font-bold uppercase tracking-wide text-zinc-500">Prazo</span><strong className="mt-1 block text-sm text-zinc-900 dark:text-white">{formatDate(dueDate)}</strong></div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"><span className="block text-[10px] font-bold uppercase tracking-wide text-zinc-500">Status atual</span><strong className="mt-1 block text-sm text-zinc-900 dark:text-white">{currentStatus?.name || 'Sem status'}</strong></div>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40">
        <div className="space-y-4">
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">Escopo operacional</span><p className="whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-300">{activity.description || 'Nenhum detalhe informado.'}</p></div>
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Processo SEI</span><ProcessoSeiDisplay activity={activity as DashboardActivity} /></div>
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Gargalos reportados</span><p className="whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-300">{activity.difficulties || 'Sem restrições reportadas.'}</p></div>
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Entregas finais</span><p className="whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-300">{activity.suggestions || 'Em fase de processamento.'}</p></div>
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Comentários internos / bloco de notas</span><p className="whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-300">{getInternalNotes(activity as DashboardActivity) || 'Nenhuma anotação interna registrada.'}</p></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statuses.map(status => (
          <button type="button" key={status.id} onClick={() => handleStatusChange(status.id)} disabled={statusUpdating || activity.status_id === status.id} className={`rounded-lg border p-2 text-[11px] font-bold uppercase tracking-wide transition disabled:cursor-not-allowed ${activity.status_id === status.id ? 'border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' : 'border-zinc-200 text-zinc-500 hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600'}`}>{status.name}</button>
        ))}
      </div>
      <div className="flex gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button type="button" onClick={onEdit} disabled={statusUpdating} className="flex-1 rounded-lg bg-zinc-900 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-700 dark:hover:bg-zinc-600">Editar</button>
        <button type="button" onClick={onDelete} disabled={statusUpdating} className="rounded-lg border border-rose-200 bg-rose-50 px-6 py-2 text-xs font-bold uppercase tracking-wide text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">Remover</button>
      </div>
    </div>
  </Modal>
  );
};

const AllTasksModal: React.FC<{
  onClose: () => void;
  items: EnrichedActivity[];
  statuses: Status[];
  onOpenActivity: (activity: DashboardActivity) => void;
}> = ({ onClose, items, statuses, onOpenActivity }) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [deadlineFilter, setDeadlineFilter] = useState('all');

  const fieldClass = 'h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-sky-500/20';

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    return [...items]
      .filter(item => {
        const activity = item.activity;
        const matchesQuery = !normalizedQuery || normalizeText([
          activity.name,
          activity.description,
          activity.difficulties,
          activity.suggestions,
          getProcessoSei(activity),
          getInternalNotes(activity),
          item.statusName,
          item.category,
          item.responsible
        ].filter(Boolean).join(' ')).includes(normalizedQuery);
        const matchesStatus = statusFilter === 'all' || activity.status_id === statusFilter;
        const matchesType = typeFilter === 'all' || activity.type === typeFilter;
        const matchesPriority = priorityFilter === 'all' || item.priority === priorityFilter;
        const matchesDeadline =
          deadlineFilter === 'all' ||
          (deadlineFilter === 'overdue' && item.isOverdue) ||
          (deadlineFilter === 'today' && item.isDueToday) ||
          (deadlineFilter === 'seven' && item.daysUntilDue !== null && item.daysUntilDue >= 0 && item.daysUntilDue <= 7) ||
          (deadlineFilter === 'no-date' && !item.dueDate) ||
          (deadlineFilter === 'completed' && item.isCompleted);

        return matchesQuery && matchesStatus && matchesType && matchesPriority && matchesDeadline;
      })
      .sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        const aDays = a.daysUntilDue ?? 9999;
        const bDays = b.daysUntilDue ?? 9999;
        return (aDays - bDays) || (priorityRank[b.priority] - priorityRank[a.priority]) || a.activity.name.localeCompare(b.activity.name);
      });
  }, [items, query, statusFilter, typeFilter, priorityFilter, deadlineFilter]);

  return (
    <Modal title="Visão geral de tarefas" onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_160px_150px_150px_180px]">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar por tarefa, SEI, responsável, status ou anotação"
              className={`${fieldClass} w-full pl-9`}
            />
          </div>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className={`${fieldClass} pr-9`}>
            <option value="all">Todos status</option>
            {statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
          </select>
          <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className={`${fieldClass} pr-9`}>
            <option value="all">Todos tipos</option>
            <option value={ActivityType.MACRO}>Macro</option>
            <option value={ActivityType.MICRO}>Micro</option>
          </select>
          <select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)} className={`${fieldClass} pr-9`}>
            <option value="all">Prioridade</option>
            {(['Crítica', 'Alta', 'Média', 'Normal'] as PriorityLevel[]).map(priority => <option key={priority} value={priority}>{priority}</option>)}
          </select>
          <select value={deadlineFilter} onChange={event => setDeadlineFilter(event.target.value)} className={`${fieldClass} pr-9`}>
            <option value="all">Todos prazos</option>
            <option value="overdue">Atrasadas</option>
            <option value="today">Vencem hoje</option>
            <option value="seven">Próximos 7 dias</option>
            <option value="completed">Concluídas</option>
            <option value="no-date">Sem prazo</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300">
          <span><strong className="text-zinc-950 dark:text-white">{filteredItems.length}</strong> de {items.length} tarefa(s) exibida(s)</span>
          <button
            type="button"
            onClick={() => { setQuery(''); setStatusFilter('all'); setTypeFilter('all'); setPriorityFilter('all'); setDeadlineFilter('all'); }}
            className="text-xs font-bold uppercase tracking-wide text-sky-700 transition hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-200"
          >
            Limpar filtros
          </button>
        </div>

        <div className="custom-scrollbar max-h-[54vh] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          {filteredItems.length ? (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredItems.map(item => {
                const processoSei = getProcessoSei(item.activity);
                return (
                  <button
                    key={item.activity.id}
                    type="button"
                    onClick={() => onOpenActivity(item.activity)}
                    className="grid w-full grid-cols-1 gap-3 bg-white p-4 text-left transition hover:bg-sky-50/50 dark:bg-zinc-950/30 dark:hover:bg-sky-500/5 xl:grid-cols-[minmax(0,1fr)_150px_170px_150px]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {item.activity.type === ActivityType.MACRO ? 'Macro' : 'Micro'}
                        </span>
                        <PriorityBadge priority={item.priority} />
                      </div>
                      <p className="mt-2 text-sm font-bold text-zinc-950 dark:text-white">{item.activity.name}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{item.category}</span>
                        {item.responsible && <span>Responsável: {item.responsible}</span>}
                        {processoSei && <span className="truncate">SEI: {processoSei}</span>}
                      </div>
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">{formatDeadline(item)}</div>
                    <StatusBadge statusName={item.statusName} color={statuses.find(status => status.id === item.activity.status_id)?.color} />
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">{getInternalNotes(item.activity) ? 'Com anotação interna' : 'Sem anotação'}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-5">
              <EmptyState title="Nenhuma tarefa encontrada" text="Ajuste ou limpe os filtros para ampliar a visão geral." />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

interface ManageStatusModalProps {
  onClose: () => void;
  statuses: Status[];
  onAddStatus: (name: string, color: string) => Promise<boolean>;
  onDeleteStatus: (statusId: string) => Promise<boolean>;
}

const ManageStatusModal: React.FC<ManageStatusModalProps> = ({ onClose, statuses, onAddStatus, onDeleteStatus }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0ea5e9');
  const [processing, setProcessing] = useState('');

  const handleAdd = async () => {
    if (!name.trim() || processing) return;
    setProcessing('add');
    const added = await onAddStatus(name, color);
    if (added) setName('');
    setProcessing('');
  };

  const handleDelete = async (statusId: string) => {
    if (processing) return;
    setProcessing(statusId);
    await onDeleteStatus(statusId);
    setProcessing('');
  };

  return (
    <Modal title="Configuração de status" onClose={onClose}>
      <div className="space-y-4">
        <div className="custom-scrollbar max-h-60 space-y-3 overflow-y-auto pr-2">
          {statuses.map(status => (
            <div key={status.id} className="group flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3 transition dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="flex min-w-0 items-center gap-3"><div className="h-7 w-1 rounded-full" style={{ backgroundColor: status.color }} /><span className="truncate text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">{status.name}</span></div>
              <button type="button" onClick={() => handleDelete(status.id)} disabled={Boolean(processing)} className="text-[11px] font-bold uppercase tracking-wide text-rose-600 opacity-70 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-rose-300">{processing === status.id ? 'Removendo...' : 'Remover'}</button>
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
          <input className="min-w-0 flex-1 border-b border-zinc-300 bg-transparent text-sm text-zinc-900 outline-none transition focus:border-sky-500 dark:border-zinc-700 dark:text-white" placeholder="Novo status" value={name} onChange={event => setName(event.target.value)} />
          <input type="color" value={color} onChange={event => setColor(event.target.value)} className="h-10 w-10 cursor-pointer rounded border border-zinc-300 bg-transparent p-1 dark:border-zinc-700" />
          <button type="button" onClick={handleAdd} disabled={!name.trim() || Boolean(processing)} aria-label="Adicionar status" title="Adicionar status" className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-700 text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"><Icon name="plus" className="h-4 w-4" /></button>
        </div>
      </div>
    </Modal>
  );
};

interface DataManagementModalProps {
  onClose: () => void;
  onExport: () => void | Promise<void>;
  onImport: (file: File) => Promise<boolean>;
  onTemplate: () => void | Promise<void>;
}

const DataManagementModal: React.FC<DataManagementModalProps> = ({ onClose, onExport, onImport, onTemplate }) => {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const cardClass = 'rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition dark:border-zinc-800 dark:bg-zinc-950/40';
  const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wide';

  const handleImport = async () => {
    if (!file || processing) return;
    setProcessing(true);
    const imported = await onImport(file);
    if (!imported) setProcessing(false);
  };

  return (
    <Modal title="Gestão de dados" onClose={onClose}>
      <div className="space-y-6">
        <div className={cardClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div><span className={`${labelClass} text-sky-700 dark:text-sky-300`}>Backup estrutural</span><h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Exportar base total</h3><p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">Snapshot completo em formato .XLSX.</p></div>
            <button type="button" onClick={onExport} className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-sky-700 transition hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"><Icon name="database" className="h-4 w-4" /> Gerar backup</button>
          </div>
        </div>
        <div className={cardClass}>
          <span className={`${labelClass} text-amber-700 dark:text-amber-300`}>Importação em lote</span>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Processamento de planilha</h3>
          <div className="my-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/25 dark:bg-amber-500/10"><span className="text-xs text-amber-700 dark:text-amber-300">Vincule pelo nome exato do projeto pai.</span><button type="button" onClick={onTemplate} className="text-[11px] font-bold uppercase tracking-wide text-amber-700 underline underline-offset-4 transition hover:text-amber-900 dark:text-amber-300">Baixar modelo</button></div>
          <label className="mb-4 flex h-24 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-3 text-center transition hover:border-sky-300 dark:border-zinc-700 dark:bg-zinc-950/40 dark:hover:border-sky-500/50">
            <Icon name="file" className="mb-2 h-5 w-5 text-zinc-400" />
            <p className="w-full truncate text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{file ? file.name : 'Selecionar arquivo .XLSX'}</p>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={event => setFile(event.target.files ? event.target.files[0] : null)} />
          </label>
          <button type="button" onClick={handleImport} disabled={!file || processing} className={`w-full rounded-lg py-3 text-xs font-bold uppercase tracking-wide transition ${file && !processing ? 'bg-sky-700 text-white hover:bg-sky-600' : 'cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'}`}>{processing ? 'Processando planilha...' : 'Iniciar carga de dados'}</button>
        </div>
      </div>
    </Modal>
  );
};

interface ReportModalProps {
  onClose: () => void;
  activities: Activity[];
  statuses: Status[];
  onGenerate: (start: string, end: string) => void;
  theme: ThemeMode;
}

const ReportModal: React.FC<ReportModalProps> = ({ onClose, activities, statuses, onGenerate, theme }) => {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [periodError, setPeriodError] = useState('');
  const data = statuses.map((status: Status) => ({
    name: status.name,
    value: activities.filter((activity: Activity) => activity.status_id === status.id).length,
    color: status.color
  })).filter(item => item.value > 0);
  const handleGenerate = () => {
    if (start && end && start > end) {
      setPeriodError('A data inicial não pode ser posterior à data final.');
      return;
    }
    setPeriodError('');
    onGenerate(start, end);
  };

  return (
    <Modal title="Analytics executivo" onClose={onClose}>
      <div className="space-y-6">
        <React.Suspense fallback={<div className="flex h-64 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">Carregando gráficos...</div>}>
          <ReportCharts data={data} theme={theme} />
        </React.Suspense>
        <div className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Extração executiva (.DOCX)</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <input type="date" value={start} onChange={event => setStart(event.target.value)} className="w-full rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:focus:ring-sky-500/20" />
            <input type="date" value={end} onChange={event => setEnd(event.target.value)} className="w-full rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:focus:ring-sky-500/20" />
          </div>
          {periodError && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{periodError}</p>}
          <button type="button" onClick={handleGenerate} className="w-full rounded-lg bg-sky-700 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-sky-600">Gerar relatório oficial (.DOC)</button>
        </div>
      </div>
    </Modal>
  );
};

export default App;
