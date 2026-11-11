import type { SupabaseClient } from '@supabase/supabase-js'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

// Dati della Home del manager (design MTHome): riepilogo del giorno,
// indicatori di cassa, tabella dei locali con la chiusura di ieri e la
// lista "Da fare". Tutto letto con il client dell'utente: RLS limita già
// ai locali che gestisce; in più la Home del manager si ferma ai locali
// visibili (attivi, o il solo locale aperto in archivio), così un locale
// nascosto non porta chiusure "mancanti", cose da fare o totali.

export interface VoceSpesa { nome: string; categoria: string | null; importo: number }

/** Chiusura di ieri di un locale, per il foglio di dettaglio sul telefono. */
export interface ChiusuraIeri {
  contanti: number
  pos: number
  bonifico: number
  totale: number
  asporto: number
  coperti: number
  fondoIniziale: number
  spese: number
  voci: VoceSpesa[]
  fondoFinale: number
  bancaTeorica: number
  contantiBanca: number
  differenza: number
}

export interface LocaleHome {
  id: string
  nome: string
  /** Posizione nell'elenco per nome: dà il colore del locale come nelle altre schermate. */
  indice: number
  ieri: number | null
  ieriPrima: number | null
  contantiBanca: number | null
  andamento: (number | null)[]
  stato: 'inviata' | 'revisione' | 'mancante'
  mese: number
  chiusura: ChiusuraIeri | null
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
  /** "giovedì 8 ottobre" */
  ieriLungo: string
  /** "gio 8 ottobre" */
  ieriMedio: string
  /** "gio 8 ott" */
  ieriBreve: string
  /** "gio 8" */
  ieriCorto: string
  /** "gio 1 ott" e "gio 1": lo stesso giorno della settimana prima. */
  primaBreve: string
  primaCorto: string
  /** "Ottobre" e "1–8 settembre" */
  meseNome: string
  meseConfronto: string
  totaleIeri: number
  /** Variazione % sullo stesso giorno della settimana prima, sui locali confrontabili. */
  deltaIeri: number | null
  locali: LocaleHome[]
  totaleMese: number
  totaleMesePrima: number | null
  mediaIeri: number | null
  mediaPrima: number | null
  contantiIeri: number
  daFare: CosaDaFare[]
  riepilogo: string
  /** Solo per la Home a un locale (direttore): coperti di ieri e della settimana prima. */
  copertiIeri: number | null
  copertiPrima: number | null
  /** "Gio 1", "Ven 2", "Sab 3": i giorni da ieri in avanti, una settimana prima. */
  settimanaScorsa: { etichetta: string; coperti: number | null }[]
}

const giorno = (d: Date) => formatInTimeZone(d, TZ, 'yyyy-MM-dd')
const piuGiorni = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const fmt = (iso: string, p: string) => formatInTimeZone(new Date(`${iso}T12:00:00Z`), TZ, p, { locale: it })
const maiuscola = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function percento(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null
  return ((a - b) / b) * 100
}

/** "+6,1%" / "−3,4%" con il segno meno tipografico del design. */
export function pc(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')}%`
}
/** Euro senza decimali, migliaia sempre separate (anche 4 cifre). */
export function eu0(v: number): string {
  return `€ ${Math.round(v).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)}`
}
export function eu2(v: number): string {
  return `€ ${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)}`
}

/** Intervallo di un'assenza: "20–24 ottobre · 5 giorni", "28 ottobre–2 novembre · 6 giorni", "Mer 14 ottobre". */
export function fmtGiorni(a: string, b: string): string {
  if (a === b) return maiuscola(fmt(a, 'EEE d MMMM'))
  const n = Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000) + 1
  const da = a.slice(0, 7) === b.slice(0, 7) ? fmt(a, 'd') : fmt(a, 'd MMMM')
  return `${da}–${fmt(b, 'd MMMM')} · ${n} giorni`
}

export const TIPI_ASSENZA: Record<string, string> = { ferie: 'Ferie', malattia: 'Malattia', riposo: 'Riposo', assenza_ingiustificata: 'Assenza', permesso: 'Permesso' }

const uno = <X,>(v: X | X[] | null | undefined): X | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

/**
 * `restaurantId`: Home a un solo locale (Direttore Smartphone / Tablet v2,
 * MTHome "single"): niente chiusure mancanti né modifiche in "Da fare"
 * (il direttore non ha la Cassa), solo le richieste del suo locale.
 * `archivio`: id del locale nascosto aperto in archivio (solo manager; lo
 * passa la pagina, perché questo modulo è importato anche dal client e
 * non può leggere il cookie).
 */
export async function datiHomeManager(supabase: SupabaseClient, restaurantId: string | null = null, archivio: string | null = null): Promise<DatiHome> {
  const singolo = restaurantId !== null
  // Filtro sul locale solo nella Home a un locale (tipizzato in modo lasco:
  // il vincolo generico sui builder di Postgrest fa esplodere il compilatore).
  // Locali della Home. Il direttore ha il suo (anche se nascosto); il
  // manager quelli visibili: stessa regola di soloVisibili (lib/localiVisibili).
  const qLocali = supabase.from('restaurants').select('id, name').order('name')
  const { data: ristoranti } = await (singolo ? qLocali.eq('id', restaurantId!) : archivio ? qLocali.eq('id', archivio) : qLocali.eq('nascosto', false))
  const idsLocali = (ristoranti ?? []).map(r => r.id as string)
  // Ogni lettura segue quell'elenco (con nessun locale visibile `in ()` dà
  // semplicemente zero righe).
  const solo = <Q,>(q: Q, col = 'restaurant_id'): Q => (singolo
    ? (q as unknown as { eq: (c: string, v: string) => Q }).eq(col, restaurantId!)
    : (q as unknown as { in: (c: string, v: string[]) => Q }).in(col, idsLocali))
  const oggi = giorno(new Date())
  const ieri = piuGiorni(oggi, -1)
  const settePrima = piuGiorni(ieri, -7)
  const inizio7 = piuGiorni(ieri, -6)
  const meseInizio = `${ieri.slice(0, 7)}-01`
  const giornoMese = Number(ieri.slice(8, 10))
  const mesePrimaInizio = (() => { const d = new Date(`${meseInizio}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10) })()
  // Stessi giorni del mese prima, senza sforare nel mese corrente (es. 31 → 30 novembre).
  const fineMesePrima = piuGiorni(meseInizio, -1)
  const mesePrimaFine = [piuGiorni(mesePrimaInizio, giornoMese - 1), fineMesePrima].sort()[0]

  const [{ data: chiusure }, { data: chiusurePrima }, { data: assenze }, { data: foto }, { data: modificheTutte }, { data: fattureDubbie }] = await Promise.all([
    supabase.from('cassa_chiusure').select('id, restaurant_id, data, totale_entrate, contanti_per_banca, coperti, incasso_asporto, stato, entrate_contanti, entrate_pos, entrate_bonifico, fondo_cassa_iniziale, fondo_cassa_finale, banca_teorica, differenza, totale_spese_giornaliere')
      .in('restaurant_id', idsLocali).gte('data', settePrima < meseInizio ? settePrima : meseInizio).lte('data', ieri),
    supabase.from('cassa_chiusure').select('restaurant_id, totale_entrate').in('restaurant_id', idsLocali).eq('stato', 'confermata').gte('data', mesePrimaInizio).lte('data', mesePrimaFine),
    solo(supabase.from('absences').select('id, type, start_date, end_date, restaurant_id, profile:profiles!user_id(full_name)').eq('status', 'pending')).order('start_date').limit(30),
    solo(supabase.from('attendances').select('id, check_in, restaurant_id, profile:profiles!user_id(full_name)').eq('needs_manager_approval', true)).order('check_in', { ascending: false }).limit(20),
    singolo ? Promise.resolve({ data: [] }) : supabase.from('cassa_chiusure_modifiche').select('id, chiusura_id, payload, chiusura:cassa_chiusure(data, restaurant_id, entrate_contanti)').eq('stato', 'in_attesa').limit(100),
    // Stessa definizione di "da verificare" di hub_indicatori_acquisti:
    // fatture con almeno un dato letto sospetto.
    solo(supabase.from('fatture').select('id, fornitore:fornitori(nome)').neq('verifiche_sospette', '[]')).limit(100),
  ])

  const rs = ristoranti ?? []
  // Le modifiche non hanno il locale in riga: si tengono quelle la cui
  // chiusura è di un locale in elenco (le prime 20, come prima).
  const modifiche = ((modificheTutte ?? []) as { id: string; chiusura_id: string; payload: Record<string, number> | null; chiusura: unknown }[])
    .filter(m => { const ch = uno(m.chiusura as { restaurant_id: string } | { restaurant_id: string }[] | null); return !!ch && idsLocali.includes(ch.restaurant_id) })
    .slice(0, 20)
  const nomeDi = (id: string | null) => rs.find(r => r.id === id)?.name ?? '—'
  type C = {
    id: string; restaurant_id: string; data: string; totale_entrate: number; contanti_per_banca: number; coperti: number; incasso_asporto: number; stato: string
    entrate_contanti: number; entrate_pos: number; entrate_bonifico: number; fondo_cassa_iniziale: number; fondo_cassa_finale: number; banca_teorica: number; differenza: number; totale_spese_giornaliere: number
  }
  // Con un solo locale servono anche ieri−6 e ieri−5 ("Coperti della settimana scorsa"):
  // il range parte comunque da settePrima, quindi sono già inclusi.
  const cs = (chiusure ?? []) as C[]
  const conf = cs.filter(c => c.stato === 'confermata')
  const inRevisione = new Set(modifiche.map(m => m.chiusura_id))

  // Voci di spesa delle chiusure di ieri, per il dettaglio "Spese" del foglio.
  const idsIeri = conf.filter(c => c.data === ieri).map(c => c.id)
  const { data: spese } = idsIeri.length
    ? await supabase.from('cassa_spese').select('chiusura_id, nome_spesa, importo, categoria:cassa_categorie(nome)').in('chiusura_id', idsIeri)
    : { data: [] }
  const vociDi = (id: string): VoceSpesa[] => ((spese ?? []) as { chiusura_id: string; nome_spesa: string; importo: number; categoria: unknown }[])
    .filter(s => s.chiusura_id === id)
    .map(s => ({ nome: s.nome_spesa, categoria: uno(s.categoria as { nome: string } | { nome: string }[] | null)?.nome ?? null, importo: Number(s.importo) }))

  const locali: LocaleHome[] = rs.map((r, i) => {
    const mie = conf.filter(c => c.restaurant_id === r.id)
    const diIeri = mie.find(c => c.data === ieri) ?? null
    const prima = mie.find(c => c.data === settePrima) ?? null
    const andamento = Array.from({ length: 7 }, (_, k) => {
      const c = mie.find(x => x.data === piuGiorni(inizio7, k))
      return c ? Number(c.totale_entrate) : null
    })
    return {
      id: r.id,
      nome: r.name,
      indice: i,
      ieri: diIeri ? Number(diIeri.totale_entrate) : null,
      ieriPrima: prima ? Number(prima.totale_entrate) : null,
      contantiBanca: diIeri ? Number(diIeri.contanti_per_banca) : null,
      andamento,
      // Una chiusura in bozza non è ancora stata inviata: per il manager è mancante.
      stato: diIeri ? (inRevisione.has(diIeri.id) ? 'revisione' : 'inviata') : 'mancante',
      mese: mie.filter(c => c.data >= meseInizio).reduce((s, c) => s + Number(c.totale_entrate), 0),
      chiusura: diIeri ? {
        contanti: Number(diIeri.entrate_contanti), pos: Number(diIeri.entrate_pos), bonifico: Number(diIeri.entrate_bonifico),
        totale: Number(diIeri.totale_entrate), asporto: Number(diIeri.incasso_asporto), coperti: Number(diIeri.coperti),
        fondoIniziale: Number(diIeri.fondo_cassa_iniziale), spese: Number(diIeri.totale_spese_giornaliere), voci: vociDi(diIeri.id),
        fondoFinale: Number(diIeri.fondo_cassa_finale), bancaTeorica: Number(diIeri.banca_teorica),
        contantiBanca: Number(diIeri.contanti_per_banca), differenza: Number(diIeri.differenza),
      } : null,
    }
  })

  const conIeri = locali.filter(l => l.ieri !== null)
  const totaleIeri = conIeri.reduce((s, l) => s + (l.ieri ?? 0), 0)
  // Confronto omogeneo: solo i locali che hanno la chiusura in entrambi i giorni.
  const confrontabili = conIeri.filter(l => l.ieriPrima !== null)
  const totaleIeriPrima = confrontabili.length ? confrontabili.reduce((s, l) => s + (l.ieriPrima ?? 0), 0) : null
  const totaleIeriConfr = confrontabili.reduce((s, l) => s + (l.ieri ?? 0), 0)
  const totaleMese = locali.reduce((s, l) => s + l.mese, 0)
  const totaleMesePrima = (chiusurePrima ?? []).length ? (chiusurePrima ?? []).reduce((s, c) => s + Number(c.totale_entrate), 0) : null
  // Media scontrino = (totale − asporto) / coperti.
  const media = (xs: C[]) => {
    const cop = xs.reduce((s, c) => s + Number(c.coperti), 0)
    return cop ? xs.reduce((s, c) => s + Number(c.totale_entrate) - Number(c.incasso_asporto), 0) / cop : null
  }
  const ieriCs = conf.filter(c => c.data === ieri)
  const primaCs = conf.filter(c => c.data === settePrima)
  const contantiIeri = ieriCs.reduce((s, c) => s + Number(c.contanti_per_banca), 0)

  const fornitori = ((fattureDubbie ?? []) as { fornitore: unknown }[]).map(f => uno(f.fornitore as { nome: string } | { nome: string }[] | null)?.nome).filter((x): x is string => !!x)
  const nFatture = (fattureDubbie ?? []).length
  const nomiF = [...new Set(fornitori)]
  const dettaglioFatture = nomiF.length === 0 ? 'Dati letti da ricontrollare'
    : nomiF.length === 1 ? nomiF[0]
    : nomiF.length === 2 ? `${nomiF[0]} e ${nomiF[1]}`
    : `${nomiF[0]}, ${nomiF[1]} e ${nFatture - 2 === 1 ? 'un\'altra' : `altre ${nFatture - 2}`}`

  const modificheRighe = modifiche.map(m => {
    const ch = uno(m.chiusura as { data: string; restaurant_id: string; entrate_contanti: number } | { data: string; restaurant_id: string; entrate_contanti: number }[] | null)
    return { m, ch }
  })

  const daFare: CosaDaFare[] = [
    ...(assenze ?? []).map(a => ({
      id: `a-${a.id}`, tipo: 'assenza' as const, rifId: a.id as string,
      titolo: uno(a.profile as { full_name: string } | { full_name: string }[] | null)?.full_name ?? '—',
      badge: TIPI_ASSENZA[a.type as string] ?? (a.type as string), tono: 'warn' as const,
      dettaglio: `${fmtGiorni(a.start_date as string, a.end_date as string)} · ${nomeDi(a.restaurant_id as string)}`,
    })),
    ...(foto ?? []).map(f => ({
      id: `f-${f.id}`, tipo: 'foto' as const, rifId: f.id as string,
      titolo: uno(f.profile as { full_name: string } | { full_name: string }[] | null)?.full_name ?? '—',
      badge: 'Timbro con foto', tono: 'warn' as const,
      dettaglio: `Entrata ${formatInTimeZone(new Date(f.check_in as string), TZ, 'HH:mm')} · ${nomeDi(f.restaurant_id as string)}`,
    })),
    ...locali.filter(l => !singolo && l.stato === 'mancante').map(l => ({
      id: `c-${l.id}`, tipo: 'chiusura' as const, titolo: l.nome,
      badge: 'Chiusura mancante', tono: 'neg' as const,
      dettaglio: `${maiuscola(fmt(ieri, 'EEEE d MMMM'))} non è stata inviata`,
      href: '/cassa/lista-chiusure', etichetta: 'Apri',
    })),
    ...modificheRighe.map(({ m, ch }) => {
      const nuovo = m.payload?.entrate_contanti
      return {
        id: `m-${m.id}`, tipo: 'modifica' as const, titolo: nomeDi(ch?.restaurant_id ?? null),
        badge: 'Modifica chiusura', tono: 'warn' as const,
        dettaglio: ch ? `${fmt(ch.data, 'd MMMM')}${nuovo !== undefined && Number(nuovo) !== Number(ch.entrate_contanti) ? ` · contanti da ${eu2(Number(ch.entrate_contanti))} a ${eu2(Number(nuovo))}` : ''}` : '',
        href: '/cassa/approvazioni', etichetta: 'Rivedi',
      }
    }),
    ...(nFatture > 0 ? [{
      id: 'fatture', tipo: 'fatture' as const, titolo: nFatture === 1 ? '1 fattura' : `${nFatture} fatture`,
      badge: 'Da verificare', tono: 'neutral' as const, dettaglio: dettaglioFatture, href: '/acquisti/fatture', etichetta: 'Verifica',
    }] : []),
  ]

  // Riepilogo in una frase costruito dai dati (non generato da un modello:
  // niente costi né attese, sempre coerente con i numeri), sul modello del
  // testo del prototipo.
  const giornoSett = fmt(ieri, 'EEEE')
  const sulPrec = giornoSett === 'domenica' ? 'sulla domenica precedente' : `sul ${giornoSett} precedente`
  const pIeri = percento(totaleIeriConfr, totaleIeriPrima)
  const mancanti = locali.filter(l => l.stato === 'mancante').map(l => l.nome)
  const correzioni = modificheRighe.map(({ ch }) => ch ? `${nomeDi(ch.restaurant_id)} chiede di correggere la chiusura del ${fmt(ch.data, 'd MMMM')}` : null).filter(Boolean) as string[]
  const nAss = daFare.filter(d => d.tipo === 'assenza').length
  const elenco = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`
  const parti = [
    conIeri.length
      ? `${maiuscola(fmt(ieri, 'EEEE d MMMM'))}: ${eu0(totaleIeri)} su ${conIeri.length} ${conIeri.length === 1 ? 'locale' : 'locali'}${pIeri !== null ? `, ${pc(pIeri)} ${sulPrec}` : ''}.`
      : `${maiuscola(fmt(ieri, 'EEEE d MMMM'))}: nessuna chiusura inviata.`,
    [
      mancanti.length && conIeri.length ? `${elenco(mancanti)} ${mancanti.length === 1 ? 'non ha' : 'non hanno'} inviato la chiusura` : '',
      ...correzioni,
    ].filter(Boolean).join(' e ').replace(/^./, c => c.toUpperCase()),
    [nAss ? `${nAss} ${nAss === 1 ? 'assenza' : 'assenze'} da approvare` : '', nFatture ? `${nFatture} ${nFatture === 1 ? 'fattura' : 'fatture'} da verificare` : ''].filter(Boolean).join(' e '),
  ].filter(Boolean).map(s => (s.endsWith('.') ? s : `${s}.`))

  const coperti = (d: string) => { const xs = conf.filter(c => c.data === d); return xs.length ? xs.reduce((t, c) => t + Number(c.coperti), 0) : null }
  const copertiIeri = coperti(ieri)
  const mediaI = media(ieriCs)
  // Testo del prototipo per un locale: "Giovedì 8 ottobre Centro ha servito 128
  // coperti con una media scontrino di € 28,90. Hai 2 richieste da approvare e 4 fatture da verificare."
  const nRich = daFare.filter(d => d.tipo === 'assenza' || d.tipo === 'foto').length
  const riepilogoSingolo = [
    copertiIeri !== null && locali[0]
      ? `${maiuscola(fmt(ieri, 'EEEE d MMMM'))} ${locali[0].nome} ha servito ${copertiIeri} coperti${mediaI !== null ? ` con una media scontrino di ${eu2(mediaI)}` : ''}.`
      : `${maiuscola(fmt(ieri, 'EEEE d MMMM'))}: chiusura non ancora inviata.`,
    nRich || nFatture ? `Hai ${[nRich ? `${nRich} ${nRich === 1 ? 'richiesta' : 'richieste'} da approvare` : '', nFatture ? `${nFatture} ${nFatture === 1 ? 'fattura' : 'fatture'} da verificare` : ''].filter(Boolean).join(' e ')}.` : '',
  ].filter(Boolean).join(' ')

  const giorniMesePrima = Number(mesePrimaFine.slice(8, 10))
  return {
    ieriLungo: fmt(ieri, 'EEEE d MMMM'),
    ieriMedio: fmt(ieri, 'EEE d MMMM'),
    ieriBreve: fmt(ieri, 'EEE d MMM'),
    ieriCorto: fmt(ieri, 'EEE d'),
    primaBreve: fmt(settePrima, 'EEE d MMM'),
    primaCorto: fmt(settePrima, 'EEE d'),
    meseNome: maiuscola(fmt(ieri, 'MMMM')),
    meseConfronto: giorniMesePrima === 1 ? `1 ${fmt(mesePrimaInizio, 'MMMM')}` : `1–${giorniMesePrima} ${fmt(mesePrimaInizio, 'MMMM')}`,
    totaleIeri, deltaIeri: pIeri, locali, totaleMese, totaleMesePrima,
    mediaIeri: media(ieriCs), mediaPrima: media(primaCs), contantiIeri,
    daFare, riepilogo: singolo ? riepilogoSingolo : parti.join(' '),
    copertiIeri, copertiPrima: coperti(settePrima),
    settimanaScorsa: [0, 1, 2].map(k => { const d = piuGiorni(settePrima, k); return { etichetta: maiuscola(fmt(d, 'EEE d')), coperti: coperti(d) } }),
  }
}
