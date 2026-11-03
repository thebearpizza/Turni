import type { SupabaseClient } from '@supabase/supabase-js'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

// Dati della Home del manager (design MTHome): riepilogo del giorno,
// indicatori di cassa, tabella dei locali e lista "Da fare". Tutto letto
// con il client dell'utente: RLS limita già ai locali che gestisce.

export interface LocaleHome {
  id: string
  nome: string
  colore: string
  ieri: number | null
  ieriPrima: number | null
  contantiBanca: number | null
  andamento: (number | null)[]
  stato: 'inviata' | 'revisione' | 'bozza' | 'mancante'
  mese: number
}

export interface CosaDaFare {
  id: string
  tipo: 'assenza' | 'foto' | 'chiusura' | 'modifica' | 'fatture'
  titolo: string
  badge: string
  tono: 'warn' | 'neg' | 'neutral'
  dettaglio: string
  /** Per assenza e foto: id della riga da approvare. */
  rifId?: string
  href?: string
  etichetta?: string
}

export interface DatiHome {
  ieriLabel: string
  ieriBreve: string
  totaleIeri: number
  totaleIeriPrima: number | null
  locali: LocaleHome[]
  totaleMese: number
  totaleMesePrima: number | null
  mediaIeri: number | null
  mediaPrima: number | null
  contantiIeri: number
  daFare: CosaDaFare[]
  riepilogo: string
  fattureDaVerificare: number
}

const COLORI = ['oklch(0.58 0.12 180)', 'oklch(0.6 0.11 250)', 'oklch(0.72 0.12 75)', 'oklch(0.62 0.12 330)', 'oklch(0.62 0.12 20)', 'oklch(0.58 0.12 140)']

const giorno = (d: Date) => formatInTimeZone(d, TZ, 'yyyy-MM-dd')
const piuGiorni = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function percento(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null
  return ((a - b) / b) * 100
}

export async function datiHomeManager(supabase: SupabaseClient): Promise<DatiHome> {
  const oggi = giorno(new Date())
  const ieri = piuGiorni(oggi, -1)
  const settePrima = piuGiorni(ieri, -7)
  const inizio7 = piuGiorni(ieri, -6)
  const meseInizio = `${ieri.slice(0, 7)}-01`
  const giornoMese = Number(ieri.slice(8, 10))
  const mesePrimaInizio = (() => { const d = new Date(`${meseInizio}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10) })()
  const mesePrimaFine = piuGiorni(mesePrimaInizio, giornoMese - 1)

  const [{ data: ristoranti }, { data: chiusure }, { data: chiusurePrima }, { data: assenze }, { data: foto }, { data: modifiche }, fattureRes] = await Promise.all([
    supabase.from('restaurants').select('id, name').order('name'),
    supabase.from('cassa_chiusure').select('id, restaurant_id, data, totale_entrate, contanti_per_banca, coperti, incasso_asporto, stato')
      .gte('data', settePrima < meseInizio ? settePrima : meseInizio).lte('data', ieri),
    supabase.from('cassa_chiusure').select('restaurant_id, totale_entrate').gte('data', mesePrimaInizio).lte('data', mesePrimaFine),
    supabase.from('absences').select('id, type, start_date, end_date, restaurant_id, profile:profiles!user_id(full_name)').eq('status', 'pending').order('start_date').limit(20),
    supabase.from('attendances').select('id, check_in, restaurant_id, profile:profiles!user_id(full_name)').eq('needs_manager_approval', true).order('check_in', { ascending: false }).limit(10),
    supabase.from('cassa_chiusure_modifiche').select('id, chiusura_id, payload, chiusura:cassa_chiusure(data, restaurant_id, entrate_contanti)').eq('stato', 'in_attesa').limit(10),
    supabase.rpc('hub_indicatori_acquisti', { p_mese_inizio: meseInizio, p_mese_fine: ieri }).single(),
  ])

  const rs = ristoranti ?? []
  const nomeDi = (id: string | null) => rs.find(r => r.id === id)?.name ?? '—'
  type C = { id: string; restaurant_id: string; data: string; totale_entrate: number; contanti_per_banca: number; coperti: number; incasso_asporto: number; stato: string }
  const cs = (chiusure ?? []) as C[]
  const inRevisione = new Set(((modifiche ?? []) as { chiusura_id: string }[]).map(m => m.chiusura_id))

  const locali: LocaleHome[] = rs.map((r, i) => {
    const mie = cs.filter(c => c.restaurant_id === r.id)
    const diIeri = mie.find(c => c.data === ieri && c.stato === 'confermata') ?? null
    const bozzaIeri = mie.find(c => c.data === ieri && c.stato !== 'confermata') ?? null
    const prima = mie.find(c => c.data === settePrima && c.stato === 'confermata') ?? null
    const andamento = Array.from({ length: 7 }, (_, k) => {
      const d = piuGiorni(inizio7, k)
      const c = mie.find(x => x.data === d && x.stato === 'confermata')
      return c ? Number(c.totale_entrate) : null
    })
    const mese = mie.filter(c => c.data >= meseInizio && c.stato === 'confermata').reduce((s, c) => s + Number(c.totale_entrate), 0)
    return {
      id: r.id,
      nome: r.name,
      colore: COLORI[i % COLORI.length],
      ieri: diIeri ? Number(diIeri.totale_entrate) : null,
      ieriPrima: prima ? Number(prima.totale_entrate) : null,
      contantiBanca: diIeri ? Number(diIeri.contanti_per_banca) : null,
      andamento,
      stato: diIeri ? (inRevisione.has(diIeri.id) ? 'revisione' : 'inviata') : bozzaIeri ? 'bozza' : 'mancante',
      mese,
    }
  })

  const conIeri = locali.filter(l => l.ieri !== null)
  const totaleIeri = conIeri.reduce((s, l) => s + (l.ieri ?? 0), 0)
  const primaConfrontabili = conIeri.filter(l => l.ieriPrima !== null)
  const totaleIeriPrima = primaConfrontabili.length ? primaConfrontabili.reduce((s, l) => s + (l.ieriPrima ?? 0), 0) : null
  const totaleMese = locali.reduce((s, l) => s + l.mese, 0)
  const totaleMesePrima = (chiusurePrima ?? []).length ? (chiusurePrima ?? []).reduce((s, c) => s + Number(c.totale_entrate), 0) : null
  const ieriCs = cs.filter(c => c.data === ieri && c.stato === 'confermata')
  const primaCs = cs.filter(c => c.data === settePrima && c.stato === 'confermata')
  const media = (xs: C[]) => {
    const cop = xs.reduce((s, c) => s + Number(c.coperti), 0)
    return cop ? xs.reduce((s, c) => s + Number(c.totale_entrate) - Number(c.incasso_asporto), 0) / cop : null
  }
  const contantiIeri = ieriCs.reduce((s, c) => s + Number(c.contanti_per_banca), 0)
  const fattureDaVerificare = Number((fattureRes.data as { fatture_da_verificare?: number } | null)?.fatture_da_verificare ?? 0)

  const uno = <X,>(v: X | X[] | null | undefined): X | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
  const fmtGiorni = (a: string, b: string) => {
    const f = (d: string, p: string) => formatInTimeZone(new Date(`${d}T12:00:00Z`), TZ, p, { locale: it })
    if (a === b) return f(a, 'EEE d MMMM')
    const n = Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000) + 1
    return `${f(a, 'd')}–${f(b, 'd MMMM')} · ${n} giorni`
  }
  const TIPI: Record<string, string> = { ferie: 'Ferie', malattia: 'Malattia', riposo: 'Riposo', assenza_ingiustificata: 'Assenza' }
  const eur = (n: number) => `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const daFare: CosaDaFare[] = [
    ...(assenze ?? []).map(a => ({
      id: `a-${a.id}`, tipo: 'assenza' as const, rifId: a.id as string,
      titolo: uno(a.profile as { full_name: string } | { full_name: string }[] | null)?.full_name ?? '—',
      badge: TIPI[a.type as string] ?? (a.type as string), tono: 'warn' as const,
      dettaglio: `${fmtGiorni(a.start_date as string, a.end_date as string)} · ${nomeDi(a.restaurant_id as string)}`,
    })),
    ...(foto ?? []).map(f => ({
      id: `f-${f.id}`, tipo: 'foto' as const, rifId: f.id as string,
      titolo: uno(f.profile as { full_name: string } | { full_name: string }[] | null)?.full_name ?? '—',
      badge: 'Timbro con foto', tono: 'warn' as const,
      dettaglio: `Entrata ${formatInTimeZone(new Date(f.check_in as string), TZ, 'HH:mm')} · ${nomeDi(f.restaurant_id as string)}`,
    })),
    ...locali.filter(l => l.stato === 'mancante' || l.stato === 'bozza').map(l => ({
      id: `c-${l.id}`, tipo: 'chiusura' as const, titolo: l.nome,
      badge: l.stato === 'bozza' ? 'Chiusura in bozza' : 'Chiusura mancante', tono: 'neg' as const,
      dettaglio: `${formatInTimeZone(new Date(`${ieri}T12:00:00Z`), TZ, 'EEEE d MMMM', { locale: it })} ${l.stato === 'bozza' ? 'non è stata confermata' : 'non è stata inviata'}`,
      href: '/cassa/lista-chiusure', etichetta: 'Apri',
    })),
    ...((modifiche ?? []) as { id: string; payload: Record<string, number> | null; chiusura: unknown }[]).map(m => {
      const ch = uno(m.chiusura as { data: string; restaurant_id: string; entrate_contanti: number } | { data: string; restaurant_id: string; entrate_contanti: number }[] | null)
      const nuovoContanti = m.payload?.entrate_contanti
      return {
        id: `m-${m.id}`, tipo: 'modifica' as const, titolo: nomeDi(ch?.restaurant_id ?? null),
        badge: 'Modifica chiusura', tono: 'warn' as const,
        dettaglio: ch ? `${formatInTimeZone(new Date(`${ch.data}T12:00:00Z`), TZ, 'd MMMM', { locale: it })}${nuovoContanti !== undefined ? ` · contanti da ${eur(Number(ch.entrate_contanti))} a ${eur(nuovoContanti)}` : ''}` : '',
        href: '/cassa/approvazioni', etichetta: 'Rivedi',
      }
    }),
    ...(fattureDaVerificare > 0 ? [{
      id: 'fatture', tipo: 'fatture' as const, titolo: fattureDaVerificare === 1 ? '1 fattura' : `${fattureDaVerificare} fatture`,
      badge: 'Da verificare', tono: 'neutral' as const, dettaglio: 'Dati letti da ricontrollare', href: '/acquisti/fatture', etichetta: 'Verifica',
    }] : []),
  ]

  // Riepilogo del giorno in una frase, costruito dai dati (non generato da
  // un modello: niente costi né attese, sempre coerente con i numeri).
  const ieriLabel = formatInTimeZone(new Date(`${ieri}T12:00:00Z`), TZ, 'EEEE d MMMM', { locale: it })
  const pIeri = percento(totaleIeri, totaleIeriPrima)
  const mancanti = locali.filter(l => l.stato === 'mancante' || l.stato === 'bozza').map(l => l.nome)
  const nAss = daFare.filter(d => d.tipo === 'assenza').length
  const parti = [
    conIeri.length
      ? `${ieriLabel.charAt(0).toUpperCase()}${ieriLabel.slice(1)}: ${eur(totaleIeri)} su ${conIeri.length} ${conIeri.length === 1 ? 'locale' : 'locali'}${pIeri !== null ? `, ${pIeri >= 0 ? '+' : ''}${pIeri.toFixed(1).replace('.', ',')}% sullo stesso giorno della settimana prima` : ''}.`
      : `${ieriLabel.charAt(0).toUpperCase()}${ieriLabel.slice(1)}: nessuna chiusura inviata.`,
    mancanti.length ? `${mancanti.join(', ')} ${mancanti.length === 1 ? 'non ha' : 'non hanno'} inviato la chiusura.` : '',
    (nAss || fattureDaVerificare) ? `${[nAss ? `${nAss} ${nAss === 1 ? 'assenza' : 'assenze'} da approvare` : '', fattureDaVerificare ? `${fattureDaVerificare} ${fattureDaVerificare === 1 ? 'fattura' : 'fatture'} da verificare` : ''].filter(Boolean).join(' e ')}.` : '',
  ].filter(Boolean)

  return {
    ieriLabel,
    ieriBreve: formatInTimeZone(new Date(`${ieri}T12:00:00Z`), TZ, 'EEE d MMM', { locale: it }),
    totaleIeri, totaleIeriPrima, locali, totaleMese, totaleMesePrima,
    mediaIeri: media(ieriCs), mediaPrima: media(primaCs), contantiIeri,
    daFare, riepilogo: parti.join(' '), fattureDaVerificare,
  }
}
