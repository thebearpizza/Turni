import type { SupabaseClient } from '@supabase/supabase-js'
import type { Ruolo } from './navigazione'

const ETICHETTE: Record<Ruolo, string> = {
  manager: 'Manager',
  direttore: 'Direttore',
  capo_servizio: 'Capo servizio',
  dipendente: 'Dipendente',
  cassiere: 'Cassiere',
  hostess: 'Hostess',
  consulente_lavoro: 'Consulente del lavoro',
}

interface ProfiloMinimo {
  role: string
  is_direttore?: boolean | null
  full_name: string
  department?: string | null
  managed_restaurant_ids?: string[] | null
  restaurant?: { id: string; name: string } | { id: string; name: string }[] | null
}

export function ruoloDa(p: { role: string; is_direttore?: boolean | null }): Ruolo {
  if (p.role === 'capo_servizio' && p.is_direttore) return 'direttore'
  return p.role as Ruolo
}

// Dati che l'intestazione del guscio (AppShell) mostra: nome, riga del
// profilo, locale e i QR dei locali visibili. Letti lato server nei layout.
export async function datiShell(supabase: SupabaseClient, profile: ProfiloMinimo) {
  const ruolo = ruoloDa(profile)
  const rest = Array.isArray(profile.restaurant) ? profile.restaurant[0] : profile.restaurant
  const conQr = ruolo === 'manager' || ruolo === 'direttore' || ruolo === 'capo_servizio'

  let ristoranti: { id: string; name: string; qr_secret: string | null }[] = []
  if (conQr) {
    const q = supabase.from('restaurants').select('id, name, qr_secret').order('name')
    const { data } = ruolo === 'manager' ? await q : await q.eq('id', rest?.id ?? '')
    ristoranti = data ?? []
  }

  const etichetta = ETICHETTE[ruolo]
  const reparto = profile.department ? ` · ${profile.department}` : ''
  const descrizione = ruolo === 'manager'
    ? `${etichetta} · ${ristoranti.length} ${ristoranti.length === 1 ? 'locale' : 'locali'}`
    : `${etichetta}${rest?.name ? ` · ${rest.name}` : ''}`

  return {
    ruolo,
    nome: profile.full_name,
    descrizione,
    locale: rest?.name ? { nome: rest.name, sotto: `${etichetta}${reparto}` } : undefined,
    ristoranti,
    isPlatformOwner: profile.role === 'manager' && profile.managed_restaurant_ids === null,
  }
}
