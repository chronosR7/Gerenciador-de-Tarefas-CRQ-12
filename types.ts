export enum ActivityType {
  MACRO = 'MACRO',
  MICRO = 'MICRO',
}

export interface Status {
  id: string;
  name: string;
  color: string;
}

export interface StatusChange {
  statusId: string;
  date: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  name: string;
  description: string;
  status_id: string;
  statusHistory?: StatusChange[];
  suggestions?: string;
  difficulties?: string;
  suspensionReason?: string;
  macro_id?: string | null;
  user_id?: string;
  activity_date?: string | null;
  due_date?: string | null;
  deadline?: string | null;
  prazo?: string | null;
  priority?: string | null;
  prioridade?: string | null;
  category?: string | null;
  categoria?: string | null;
  responsible?: string | null;
  responsavel?: string | null;
  processo_sei?: string | null;
  process_sei?: string | null;
  internal_notes?: string | null;
  comentarios_internos?: string | null;
  createdAt?: string;
  created_at: string;
}

export type ViewMode = 'card' | 'table';

export type ModalType =
  | { type: 'ADD_ACTIVITY'; macroId?: string }
  | { type: 'EDIT_ACTIVITY'; activity: Activity }
  | { type: 'VIEW_ACTIVITY'; activity: Activity }
  | { type: 'REPORT' }
  | { type: 'MANAGE_STATUS' }
  | { type: 'SUSPENSION_REASON'; activity: Activity; newStatusId: string }
  | { type: 'TEXT_REPORT_DISPLAY'; reportText: string }
  | { type: 'GOOGLE_DRIVE_SYNC' }
  | { type: 'CONFIRM_DELETE'; activityId: string }
  | null;
