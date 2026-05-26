export type Role = 'manager' | 'capo_servizio' | 'dipendente'
export type AbsenceType = 'ferie' | 'malattia' | 'riposo' | 'assenza_ingiustificata'
export type AbsenceStatus = 'pending' | 'approved' | 'rejected'
export type BulletinTarget = 'all' | 'restaurant' | 'role' | 'users'

export interface Restaurant {
  id: string
  name: string
  address: string | null
  qr_secret: string
  created_at: string
}

export type Department = 'Sala' | 'Pizzeria' | 'Bar' | 'Cucina'

export const DEPARTMENTS: Department[] = ['Sala', 'Pizzeria', 'Bar', 'Cucina']

export interface Profile {
  id: string
  full_name: string
  username: string | null
  role: Role
  department: Department | null
  restaurant_id: string | null
  can_post_bulletin: boolean
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
