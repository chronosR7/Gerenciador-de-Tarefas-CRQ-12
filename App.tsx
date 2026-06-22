import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Activity, ActivityType, Status } from './types';
import { supabase } from './lib/supabaseClient';
import Login from './Login';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis
} from 'recharts';
import * as XLSX from 'xlsx';

type ThemeMode = 'light' | 'dark';
type DashboardActivity = Activity & Record<string, any>;
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

const normalizeText = (value?: string | null) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const toDateOnly = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
  toDateOnly(activity.due_date || activity.deadline || activity.prazo || activity.activity_date || activity.created_at);

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
  const [session, setSession] = useState<any>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [modal, setModal] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);
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

    const { data: sData } = await supabase.from('statuses').select('*').order('name', { ascending: true });
    const { data: aData } = await supabase.from('activities').select('*').order('created_at', { ascending: false });
    if (sData) setStatuses(sData);
    if (aData) setActivities(aData);
    setLoading(false);
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
      const daysUntilDue = dueDate ? Math.round((dueDate.getTime() - todayOnly.getTime()) / DAY_IN_MS) : null;
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
        isOverdue: !isCompleted && daysUntilDue !== null && daysUntilDue < 0,
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
      const institutionalDeadline = Boolean(item.domain);
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

  const getMicroActivities = (macroId: string) =>
    filteredActivities.filter(activity => activity.type === ActivityType.MICRO && activity.macro_id === macroId);

  const getEnrichedItem = (activityId: string) =>
    enrichedActivities.find(item => item.activity.id === activityId);

  const toggleMacro = (macroId: string) =>
    setExpandedMacros(prev => prev.includes(macroId) ? prev.filter(id => id !== macroId) : [...prev, macroId]);

  const addActivity = async (activity: any) => {
    const { error } = await supabase.from('activities').insert([{ ...activity, user_id: session.user.id }]);
    if (error) alert('Erro: ' + error.message);
    else {
      setModal(null);
      fetchData();
    }
  };

  const updateActivity = async (activity: any) => {
    const { error } = await supabase.from('activities').update(activity).eq('id', activity.id);
    if (error) alert('Erro: ' + error.message);
    else {
      setModal(null);
      fetchData();
    }
  };

  const deleteActivity = async (activityId: string) => {
    if (!window.confirm('Excluir?')) return;

    await supabase.from('activities').delete().eq('id', activityId);
    fetchData();
    setModal(null);
  };

  const addStatus = async (name: string, color: string) => {
    await supabase.from('statuses').insert([{ name, color, user_id: session.user.id }]);
    fetchData();
  };

  const deleteStatus = async (statusId: string) => {
    await supabase.from('statuses').delete().eq('id', statusId);
    fetchData();
  };

  const signOut = () => {
    supabase.auth.signOut();
  };

  const finishPasswordRecovery = () => {
    setIsPasswordRecovery(false);
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  const exportToExcel = () => {
    const data = activities.map(a => ({
      'Nível': a.type,
      'Nome': a.name,
      'Pai': activities.find(p => p.id === a.macro_id)?.name || '',
      'Status': statusMap.get(a.status_id)?.name || 'N/A',
      'Data': new Date(a.activity_date || a.created_at).toLocaleDateString('pt-BR'),
      'Descrição': a.description || '',
      'Dificuldades': a.difficulties || '',
      'Processo SEI': getProcessoSei(a as DashboardActivity),
      'Comentários internos': getInternalNotes(a as DashboardActivity),
      'Sugestões': a.suggestions || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Database');
    XLSX.writeFile(wb, 'Backup_Workspace_2026.xlsx');
  };

  const downloadTemplate = () => {
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
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const workbook = XLSX.read(event.target?.result, { type: 'binary' });
        const json: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const rows = json.map(row => {
          const status = statuses.find(st => st.name.toLowerCase() === row['Status']?.toLowerCase());
          const parent = activities.find(activity =>
            activity.name.toLowerCase() === row['Vínculo (Projeto Pai)']?.toLowerCase() &&
            activity.type === ActivityType.MACRO
          );
          return {
            name: row['Nome da Atividade'],
            type: row['Nível']?.toUpperCase() === 'MACRO' ? ActivityType.MACRO : ActivityType.MICRO,
            macro_id: parent?.id || null,
            status_id: status ? status.id : (statuses[0]?.id || null),
            user_id: session.user.id,
            description: row['Descrição'],
            difficulties: row['Dificuldades'],
            processo_sei: row['Processo SEI'] || row['Processo Sei'] || row['SEI'] || '',
            internal_notes: row['Comentários internos'] || row['Comentarios internos'] || row['Bloco de notas'] || '',
            suggestions: row['Sugestões'],
            activity_date: new Date().toISOString(),
            created_at: new Date().toISOString()
          };
        });
        await supabase.from('activities').insert(rows);
        alert('Dados processados.');
        fetchData();
        setModal(null);
      } catch (error: any) {
        alert('Erro: ' + error.message);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const generateDocxReport = (start: string, end: string) => {
    let filtered = activities;
    if (start) filtered = filtered.filter(a => new Date(a.activity_date || a.created_at) >= new Date(start));
    if (end) filtered = filtered.filter(a => new Date(a.activity_date || a.created_at) <= new Date(end));

    const macros = filtered.filter(a => a.type === ActivityType.MACRO);
    const micros = filtered.filter(a => a.type === ActivityType.MICRO);
    const concluded = micros.filter(a => (statusMap.get(a.status_id)?.name || '').toLowerCase().match(/finalizado|concluído|concluido/));
    const ongoing = micros.filter(a => (statusMap.get(a.status_id)?.name || '').toLowerCase().includes('andamento'));
    const meetings = micros.filter(a => a.name.toLowerCase().match(/reunião|reuniao|call|alinhamento/));
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
        <p align="right">Período: ${start || 'Início'} a ${end || 'Hoje'}<br>Emissão: ${new Date().toLocaleDateString('pt-BR')}</p>

        <table class="kpi-table">
          <tr>
            <td><span class="kpi-label">Volume Total</span><span class="kpi-value">${filtered.length}</span></td>
            <td><span class="kpi-label">Eficiência</span><span class="kpi-value">${efficiency}%</span></td>
            <td><span class="kpi-label">Reuniões</span><span class="kpi-value">${meetings.length}</span></td>
            <td><span class="kpi-label">Peso Estratégico</span><span class="kpi-value">${strategyRatio}%</span></td>
          </tr>
        </table>

        <h2>1 - LISTA DE PROJETOS MACRO</h2>
        <ul>${macros.length > 0 ? macros.map(m => `<li><strong>${m.name}</strong> (Status: ${statusMap.get(m.status_id)?.name})</li>`).join('') : '<li>Nenhum projeto macro registrado.</li>'}</ul>

        <h2>2 - ATIVIDADES SEMANAIS REALIZADAS</h2>
        <h3>2.1 - Atividades Concluídas</h3>
        <ul>${concluded.length > 0 ? concluded.map(c => `<li>${c.name}</li>`).join('') : '<li>Nenhuma atividade concluída.</li>'}</ul>

        <h3>2.2 - Reuniões Realizadas</h3>
        <ul>${meetings.length > 0 ? meetings.map(r => `<li>${r.name} (Status: ${statusMap.get(r.status_id)?.name})</li>`).join('') : '<li>Nenhuma reunião registrada.</li>'}</ul>

        <h3>2.3 - Atividades em Andamento</h3>
        <ul>${ongoing.length > 0 ? ongoing.map(o => `<li>${o.name}</li>`).join('') : '<li>Nenhuma atividade em trânsito.</li>'}</ul>

        <h2>3 - OBSTÁCULOS E DESAFIOS</h2>
        <ul>${blockers.length > 0 ? blockers.map(b => `<li><strong>${b.name}:</strong> ${b.difficulties}</li>`).join('') : '<li>Operação sem impedimentos reportados.</li>'}</ul>

        <div class="ia-box">
          <h2 style="margin-top:0">Análise da IA (ChronosR7 Intelligence)</h2>
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
    link.click();
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
        return <ActivityFormModal modal={modal} onClose={closeModal} statuses={statuses} onSave={(data: any) => { modal.type === 'EDIT_ACTIVITY' ? updateActivity(data) : addActivity(data); }} macroActivities={macroActivities} />;
      case 'VIEW_ACTIVITY':
        return <ActivityDetailModal activity={modal.activity} onClose={closeModal} statuses={statuses} onStatusChange={(id: string, statusId: string) => { updateActivity({ ...modal.activity, status_id: statusId }); }} onDelete={() => deleteActivity(modal.activity.id)} onEdit={() => setModal({ type: 'EDIT_ACTIVITY', activity: modal.activity })} />;
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
                visibleMacroActivities.length ? (
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
                  </div>
                ) : (
                  <EmptyState title="Nenhum projeto encontrado" text="A busca ou o filtro atual não retornou atividades macro." />
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
                    </tbody>
                  </table>
                  {!visibleMacroActivities.length && (
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

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm">
    <div className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">{title}</h2>
        <button onClick={onClose} className="rounded-md px-2 text-2xl font-semibold leading-none text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300">&times;</button>
      </div>
      <div className="custom-scrollbar overflow-y-auto p-6 sm:p-8">{children}</div>
    </div>
  </div>
);

const ActivityFormModal: React.FC<any> = ({ modal, onClose, onSave, macroActivities, statuses }) => {
  const isEdit = modal.type === 'EDIT_ACTIVITY';
  const [name, setName] = useState(isEdit ? modal.activity.name : '');
  const [type, setType] = useState(isEdit ? modal.activity.type : ActivityType.MICRO);
  const [macroId, setMacroId] = useState(isEdit ? modal.activity.macro_id : (modal.macroId || ''));
  const [statusId, setStatusId] = useState(isEdit ? modal.activity.status_id : (statuses[0]?.id || ''));
  const [date, setDate] = useState(isEdit ? (modal.activity.activity_date || '') : new Date().toISOString().split('T')[0]);
  const [desc, setDesc] = useState(isEdit ? modal.activity.description : '');
  const [diff, setDiff] = useState(isEdit ? modal.activity.difficulties : '');
  const [sugg, setSugg] = useState(isEdit ? modal.activity.suggestions : '');
  const [processoSei, setProcessoSei] = useState(isEdit ? getProcessoSei(modal.activity) : '');
  const [internalNotes, setInternalNotes] = useState(isEdit ? getInternalNotes(modal.activity) : '');

  const fieldClass = 'mt-1.5 w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:focus:ring-sky-500/20';
  const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400';

  return (
    <Modal title={isEdit ? 'Modificar item' : 'Novo registro operacional'} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); onSave({ ...modal.activity, name, type, macro_id: macroId, status_id: statusId, activity_date: date, description: desc, difficulties: diff, suggestions: sugg, processo_sei: processoSei, internal_notes: internalNotes }); }} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className={labelClass}>Hierarquia</label><select className={fieldClass} value={type} onChange={event => setType(event.target.value as any)}><option value={ActivityType.MICRO}>Micro (Tarefa)</option><option value={ActivityType.MACRO}>Macro (Projeto)</option></select></div>
          <div><label className={labelClass}>Status inicial</label><select className={fieldClass} value={statusId} onChange={event => setStatusId(event.target.value)} required>{statuses.map((status: any) => <option key={status.id} value={status.id}>{status.name}</option>)}</select></div>
        </div>
        {type === ActivityType.MICRO && (<div><label className={labelClass}>Vínculo com projeto</label><select className={fieldClass} value={macroId} onChange={event => setMacroId(event.target.value)} required><option value="">Selecione o projeto pai</option>{macroActivities.map((macro: any) => <option key={macro.id} value={macro.id}>{macro.name}</option>)}</select></div>)}
        <div><label className={labelClass}>Título</label><input className={fieldClass} value={name} onChange={event => setName(event.target.value)} required placeholder="Ex: Call de alinhamento" /></div>
        <div><label className={labelClass}>Data base / prazo</label><input type="date" className={fieldClass} value={date} onChange={event => setDate(event.target.value)} required /></div>
        <div><label className={labelClass}>Escopo operacional</label><textarea className={fieldClass} rows={2} value={desc} onChange={event => setDesc(event.target.value)} /></div>
        <div><label className={labelClass}>Processo SEI</label><input className={fieldClass} value={processoSei} onChange={event => setProcessoSei(event.target.value)} placeholder="Cole o link do processo SEI ou informe o número/referência" /></div>
        <div><label className={labelClass}>Gargalos / impedimentos</label><textarea className={fieldClass} rows={2} value={diff} onChange={event => setDiff(event.target.value)} /></div>
        <div><label className={labelClass}>Entregas / resultados</label><textarea className={fieldClass} rows={2} value={sugg} onChange={event => setSugg(event.target.value)} /></div>
        <div><label className={labelClass}>Comentários internos / bloco de notas</label><textarea className={fieldClass} rows={4} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} placeholder="Observações, lembretes, cobranças realizadas ou informações relevantes" /></div>
        <div className="flex justify-end gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <button type="button" onClick={onClose} className="rounded-lg px-5 py-2 text-xs font-bold uppercase tracking-wide text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">Cancelar</button>
          <button type="submit" className="rounded-lg bg-sky-700 px-6 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-sky-600">Salvar registro</button>
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

const ActivityDetailModal: React.FC<any> = ({ activity, onClose, statuses, onStatusChange, onDelete, onEdit }) => (
  <Modal title="Detalhes da atividade" onClose={onClose}>
    <div className="space-y-6">
      <h3 className="border-b border-zinc-200 pb-4 text-2xl font-bold tracking-tight text-zinc-950 dark:border-zinc-800 dark:text-white">{activity.name}</h3>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40">
        <div className="space-y-4">
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">Escopo operacional</span><p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{activity.description || 'Nenhum detalhe informado.'}</p></div>
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Processo SEI</span><ProcessoSeiDisplay activity={activity} /></div>
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Gargalos reportados</span><p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{activity.difficulties || 'Sem restrições reportadas.'}</p></div>
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Entregas finais</span><p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{activity.suggestions || 'Em fase de processamento.'}</p></div>
          <div><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Comentários internos / bloco de notas</span><p className="whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-300">{getInternalNotes(activity) || 'Nenhuma anotação interna registrada.'}</p></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statuses.map((status: any) => (
          <button key={status.id} onClick={() => onStatusChange(activity.id, status.id)} className={`rounded-lg border p-2 text-[11px] font-bold uppercase tracking-wide transition ${activity.status_id === status.id ? 'border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' : 'border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600'}`}>{status.name}</button>
        ))}
      </div>
      <div className="flex gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button onClick={onEdit} className="flex-1 rounded-lg bg-zinc-900 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600">Editar</button>
        <button onClick={onDelete} className="rounded-lg border border-rose-200 bg-rose-50 px-6 py-2 text-xs font-bold uppercase tracking-wide text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">Remover</button>
      </div>
    </div>
  </Modal>
);

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
            {(['CrÃ­tica', 'Alta', 'MÃ©dia', 'Normal'] as PriorityLevel[]).map(priority => <option key={priority} value={priority}>{priority}</option>)}
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

const ManageStatusModal: React.FC<any> = ({ onClose, statuses, onAddStatus, onDeleteStatus }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0ea5e9');
  return (
    <Modal title="Configuração de status" onClose={onClose}>
      <div className="space-y-4">
        <div className="custom-scrollbar max-h-60 space-y-3 overflow-y-auto pr-2">
          {statuses.map((status: any) => (
            <div key={status.id} className="group flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3 transition dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="flex min-w-0 items-center gap-3"><div className="h-7 w-1 rounded-full" style={{ backgroundColor: status.color }} /><span className="truncate text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">{status.name}</span></div>
              <button onClick={() => onDeleteStatus(status.id)} className="text-[11px] font-bold uppercase tracking-wide text-rose-600 opacity-70 transition hover:opacity-100 dark:text-rose-300">Remover</button>
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
          <input className="min-w-0 flex-1 border-b border-zinc-300 bg-transparent text-sm text-zinc-900 outline-none transition focus:border-sky-500 dark:border-zinc-700 dark:text-white" placeholder="Novo status" value={name} onChange={event => setName(event.target.value)} />
          <input type="color" value={color} onChange={event => setColor(event.target.value)} className="h-10 w-10 cursor-pointer rounded border border-zinc-300 bg-transparent p-1 dark:border-zinc-700" />
          <button onClick={() => { if (name) onAddStatus(name, color); setName(''); }} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-700 text-white transition hover:bg-sky-600"><Icon name="plus" className="h-4 w-4" /></button>
        </div>
      </div>
    </Modal>
  );
};

const DataManagementModal: React.FC<any> = ({ onClose, onExport, onImport, onTemplate }) => {
  const [file, setFile] = useState<File | null>(null);
  const cardClass = 'rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition dark:border-zinc-800 dark:bg-zinc-950/40';
  const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wide';
  return (
    <Modal title="Gestão de dados" onClose={onClose}>
      <div className="space-y-6">
        <div className={cardClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div><span className={`${labelClass} text-sky-700 dark:text-sky-300`}>Backup estrutural</span><h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Exportar base total</h3><p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">Snapshot completo em formato .XLSX.</p></div>
            <button onClick={onExport} className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-sky-700 transition hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"><Icon name="database" className="h-4 w-4" /> Gerar backup</button>
          </div>
        </div>
        <div className={cardClass}>
          <span className={`${labelClass} text-amber-700 dark:text-amber-300`}>Importação em lote</span>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Processamento de planilha</h3>
          <div className="my-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/25 dark:bg-amber-500/10"><span className="text-xs text-amber-700 dark:text-amber-300">Vincule pelo nome exato do projeto pai.</span><button onClick={onTemplate} className="text-[11px] font-bold uppercase tracking-wide text-amber-700 underline underline-offset-4 transition hover:text-amber-900 dark:text-amber-300">Baixar modelo</button></div>
          <label className="mb-4 flex h-24 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-3 text-center transition hover:border-sky-300 dark:border-zinc-700 dark:bg-zinc-950/40 dark:hover:border-sky-500/50">
            <Icon name="file" className="mb-2 h-5 w-5 text-zinc-400" />
            <p className="w-full truncate text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{file ? file.name : 'Selecionar arquivo .XLSX'}</p>
            <input type="file" accept=".xlsx" className="hidden" onChange={event => setFile(event.target.files ? event.target.files[0] : null)} />
          </label>
          <button onClick={() => onImport(file)} disabled={!file} className={`w-full rounded-lg py-3 text-xs font-bold uppercase tracking-wide transition ${file ? 'bg-sky-700 text-white hover:bg-sky-600' : 'cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'}`}>Iniciar carga de dados</button>
        </div>
      </div>
    </Modal>
  );
};

const ReportModal: React.FC<any> = ({ onClose, activities, statuses, onGenerate, theme }) => {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const data = statuses.map((status: Status) => ({
    name: status.name,
    value: activities.filter((activity: Activity) => activity.status_id === status.id).length,
    color: status.color
  })).filter((item: any) => item.value > 0);
  const chartTooltip = theme === 'dark'
    ? { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, color: '#f4f4f5' }
    : { backgroundColor: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 8, color: '#18181b' };

  return (
    <Modal title="Analytics executivo" onClose={onClose}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex h-64 flex-col items-center rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
            <span className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Distribuição proporcional</span>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={data} innerRadius={45} outerRadius={62} dataKey="value" stroke="none" paddingAngle={5}>{data.map((entry: any, index: number) => <Cell key={index} fill={entry.color} />)}</Pie><Tooltip contentStyle={chartTooltip} /><Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '10px', paddingTop: '15px' }} /></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex h-64 flex-col items-center rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
            <span className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Volume por status</span>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: -10, right: 10 }}><XAxis type="number" hide /><YAxis dataKey="name" type="category" stroke={theme === 'dark' ? '#a1a1aa' : '#71717a'} fontSize={10} width={90} /><Tooltip cursor={{ fill: 'transparent' }} contentStyle={chartTooltip} /><Bar dataKey="value" radius={[0, 4, 4, 0]}>{data.map((entry: any, index: number) => <Cell key={index} fill={entry.color} />)}</Bar></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Extração executiva (.DOCX)</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <input type="date" value={start} onChange={event => setStart(event.target.value)} className="w-full rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:focus:ring-sky-500/20" />
            <input type="date" value={end} onChange={event => setEnd(event.target.value)} className="w-full rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:focus:ring-sky-500/20" />
          </div>
          <button onClick={() => onGenerate(start, end)} className="w-full rounded-lg bg-sky-700 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-sky-600">Gerar ofício oficial (.DOCX)</button>
        </div>
      </div>
    </Modal>
  );
};

export default App;
