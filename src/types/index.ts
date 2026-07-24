export type Role = 'manager' | 'capo_servizio' | 'dipendente' | 'consulente_lavoro' | 'cassiere'
export type AbsenceType = 'ferie' | 'malattia' | 'riposo' | 'assenza_ingiustificata'
export type AbsenceStatus = 'pending' | 'approved' | 'rejected'
export type BulletinTarget = 'all' | 'restaurant' | 'role' | 'users' | 'department'

export type AccountStatus = 'pending' | 'active'

export interface Restaurant {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  qr_secret: string
  closing_days: number[]  // 0=Dom..6=Sab
  is_demo: boolean
  owner_id: string | null
  created_at: string
}

export type Department = 'Sala' | 'Pizzeria' | 'Bar' | 'Cucina'

export const DEPARTMENTS: Department[] = ['Sala', 'Pizzeria', 'Bar', 'Cucina']

// 0=Dom..6=Sab (date-fns getDay convention)
export const WEEK_DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'] as const
export const WEEK_DAYS_FULL  = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'] as const

export interface SecondaryDepartment {
  slot_id: string    // ID della fascia oraria (shift_slot)
  priority: number   // 1=alta..3=bassa
}

export interface Profile {
  id: string
  full_name: string
  username: string | null
  role: Role
  department: Department | null
  restaurant_id: string | null
  can_post_bulletin: boolean
  is_direttore: boolean
  consultant_restaurant_ids: string[]
  can_view_hours: boolean
  last_active_at: string | null
  // ── AI scheduling fields ─────────────────────────────────────────
  weekly_rest_days: number               // default 1
  preferred_rest_day: number | null      // 0=Dom..6=Sab, opzionale
  primary_slot_ids: string[]             // fasce principali del dipendente
  secondary_departments: SecondaryDepartment[]  // fasce jolly in altri reparti (solo Manager edita)
  weekly_hours_target: number | null     // null=full-time; es. 20=part-time
  can_substitute_capo_servizio: boolean  // può stare da solo / fare da senior
  // ── SaaS fields ──────────────────────────────────────────────────────────
  account_status: AccountStatus           // pending = demo; active = pieno accesso
  managed_restaurant_ids: string[] | null // null = platform owner (vede tutto)
  created_at: string
  updated_at: string
  restaurant?: Restaurant
}

export interface Attendance {
  id: string
  user_id: string
  restaurant_id: string | null
  check_in: string
  check_out: string | null
  is_split_shift: boolean
  notes: string | null
  fallback_photo_path: string | null
  needs_manager_approval: boolean
  created_at: string
  updated_at: string
  profile?: Profile
  restaurant?: Restaurant
}

export interface Absence {
  id: string
  user_id: string
  restaurant_id: string | null
  type: AbsenceType
  start_date: string
  end_date: string
  certificate_code: string | null
  notes: string | null
  status: AbsenceStatus
  created_by: string | null
  created_at: string
  updated_at: string
  profile?: Profile
  restaurant?: Restaurant
}

export interface Bulletin {
  id: string
  title: string
  body: string
  target: BulletinTarget
  target_roles: string[]
  target_user_ids: string[]
  target_department: string | null
  restaurant_id: string | null
  created_by: string
  created_at: string
  restaurant?: Restaurant
  author?: Profile
}

export interface BulletinRead {
  id: string
  bulletin_id: string
  user_id: string
  read_at: string
  profile?: { id: string; full_name: string }
}

export interface PushSubscription {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth_key: string
  created_at: string
}

export const ABSENCE_LABELS: Record<AbsenceType, string> = {
  ferie: 'Ferie',
  malattia: 'Malattia',
  riposo: 'Riposo',
  assenza_ingiustificata: 'Assenza Ingiustificata',
}

export const ABSENCE_CODES: Record<AbsenceType, string> = {
  ferie: 'F',
  malattia: 'M',
  riposo: 'R',
  assenza_ingiustificata: 'AI',
}

export const ROLE_LABELS: Record<Role, string> = {
  manager: 'Manager',
  capo_servizio: 'Capo Servizio',
  dipendente: 'Dipendente',
  consulente_lavoro: 'Consulente del Lavoro',
  cassiere: 'Cassiere',
}

// ── Consultant Messaging ─────────────────────────────────────────────

export interface ConsultantMessage {
  id: string
  manager_id: string
  consultant_id: string
  title: string
  body: string
  attachments: Array<{ name: string; path: string }>
  sent_by_manager: boolean
  created_at: string
  read_at: string | null
  downloaded_at: string | null
  reply_to_id: string | null
}

// ── ODS (Ordine di Servizio) ─────────────────────────────────────────

export type OdsTaskType = 'quotidiana' | 'settimanale' | 'bisettimanale' | 'straordinaria'

export const ODS_TYPE_LABELS: Record<OdsTaskType, string> = {
  quotidiana:    'Quotidiana',
  settimanale:   'Settimanale',
  bisettimanale: 'Bisettimanale',
  straordinaria: 'Straordinaria',
}

export const ODS_DAYS_IT = [
  'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica',
] as const

export interface OdsTask {
  id:              string
  title:           string
  department:      string
  restaurant_id:   string
  creator_id:      string | null
  assigned_to:     string | null
  type:            OdsTaskType
  recurrence_days: string[]
  created_at:      string
  updated_at:      string
  assignee?:       { id: string; full_name: string } | null
}

export interface OdsCompletion {
  id:           string
  task_id:      string
  user_id:      string
  completed_at: string
}

// ── In-app Notifications ─────────────────────────────────────────────

export interface AppNotification {
  id:         string
  user_id:    string
  title:      string
  message:    string
  link:       string | null
  read_at:    string | null
  created_at: string
}

// ── AI Scheduling ────────────────────────────────────────────────────

export interface ShiftSlot {
  id: string
  restaurant_id: string
  department: Department
  name: string          // es. "Pranzo", "Cena", "Apertura"
  start_time: string
  end_time: string
  required_count: number
  days_of_week: number[]  // 0=Dom..6=Sab; se vuoto = tutti i giorni
  created_at: string
  updated_at: string
}

export type AiDraftStatus = 'draft' | 'confirmed' | 'cancelled'
export type AiDraftTurnStatus = 'pending' | 'modified' | 'rejected'
export type ExistingTurnsMode = 'integrate' | 'replace'

export interface AiScheduleWarning {
  day: string       // yyyy-MM-dd
  department: Department
  slot_name: string
  message: string
  missing_count?: number
}

export interface ExtraordinaryClosure {
  date: string        // yyyy-MM-dd
  department?: Department  // null = intero ristorante
}

export interface AiScheduleDraft {
  id: string
  restaurant_id: string
  week_start: string     // yyyy-MM-dd (sempre lunedì)
  status: AiDraftStatus
  department_scope: Department[] | null  // null = tutti
  generated_by: string | null
  generation_params: Record<string, unknown>
  extraordinary_closures: ExtraordinaryClosure[]
  existing_turns_mode: ExistingTurnsMode
  warnings: AiScheduleWarning[]
  created_at: string
  updated_at: string
}

export interface AiScheduleDraftTurn {
  id: string
  draft_id: string
  user_id: string
  department: Department | null
  date: string
  start_time: string
  end_time: string
  is_rest_day: boolean
  is_extraordinary: boolean
  is_cross_dept: boolean
  original_department: Department | null  // reparto di appartenenza se jolly
  warning: string | null
  status: AiDraftTurnStatus
  created_at: string
  profile?: { id: string; full_name: string }
}

// ── Gestione Turni (Shift Management) ────────────────────────────────

export interface Turn {
  id:               string
  user_id:          string
  restaurant_id:    string
  department:       Department | null
  date:             string
  start_time:       string
  end_time:         string
  is_extraordinary: boolean
  is_rest_day:      boolean
  notes:            string | null
  created_by:       string | null
  created_at:       string
  updated_at:       string
  profile?:         { id: string; full_name: string } | null
  restaurant?:      { id: string; name: string } | null
}

export interface StandardShift {
  id:            string
  user_id:       string
  restaurant_id: string
  department:    Department | null
  day_of_week:   number // 0=Dom .. 6=Sab
  start_time:    string
  end_time:      string
  created_by:    string | null
  created_at:    string
  updated_at:    string
  profile?:      { id: string; full_name: string } | null
}

// ── Cassa ──────────────────────────────────────────────────────────────

export type CassaChiusuraStato = 'confermata' | 'in_verifica'

export interface CassaChiusura {
  id:                        string
  restaurant_id:             string
  data:                      string // yyyy-MM-dd
  fondo_cassa_iniziale:      number
  entrate_contanti:          number
  entrate_pos:               number
  entrate_bonifico:          number
  totale_entrate:            number
  coperti:                   number
  incasso_asporto:           number
  media_scontrino:           number
  fondo_cassa_finale:        number
  contanti_per_banca:        number
  banca_teorica:             number
  differenza:                number
  totale_spese_giornaliere:  number
  stato:                     CassaChiusuraStato
  created_by:                string | null
  updated_by:                string | null
  created_at:                string
  updated_at:                string
}

export interface CassaCategoria {
  id:         string
  owner_id:   string
  nome:       string
  created_at: string
}

export interface CassaSpesa {
  id:           string
  chiusura_id:  string
  nome_spesa:   string
  categoria_id: string | null
  importo:      number
  created_by:   string | null
  created_at:   string
}

export type CassaModificaStato = 'in_attesa' | 'approvata' | 'rifiutata'

export interface CassaChiusuraModifica {
  id:            string
  chiusura_id:   string
  payload:       Record<string, unknown>
  richiesto_da:  string | null
  stato:         CassaModificaStato
  rivisto_da:    string | null
  rivisto_at:    string | null
  created_at:    string
}
