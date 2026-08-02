'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RestaurantMultiSelect } from '@/components/cassa/RestaurantMultiSelect'
import { ConfrontoSediTable } from '@/components/cassa/ConfrontoSediTable'
import { TrendChart } from '@/components/cassa/TrendChart'
import { CategorieBreakdownChart } from '@/components/cassa/CategorieBreakdownChart'
import { CategorieTrendChart } from '@/components/cassa/CategorieTrendChart'
import { PagamentoBreakdownChart } from '@/components/cassa/PagamentoBreakdownChart'
import { RecurringAlertsSection } from '@/components/cassa/RecurringAlertsSection'
import { AnalisiKpiRow } from '@/components/cassa/AnalisiKpiRow'
import { BestWorstDayHighlight } from '@/components/cassa/BestWorstDayHighlight'
import { CassaPill } from '@/components/cassa/CassaPill'
import { CassaFileViewer } from '@/components/cassa/CassaFileViewer'
import { formatInTimeZone } from 'date-fns-tz'
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subYears, subMonths, subDays, differenceInCalendarDays, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { FileText, FileSpreadsheet } from 'lucide-react'

const TZ = 'Europe/Rome'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  restaurants: RestaurantOption[]
}

interface Riga {
  id: string
  data: string
  restaurant_id: string
  restaurant_name: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
  coperti: number
  incasso_asporto: number
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
}

function fmtDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

interface QuickRange {
  key: string
  label: string
  start: string
  end: string
}

// Pillole rapide Oggi/Settimana/Mese/Anno: non esiste più un "preset"
// separato dal range effettivo — ogni pillola imposta direttamente
// customStart/customEnd (unica fonte di verità, sempre visibile ed
// editabile nei due campi data) e risulta "attiva" quando il range
// corrente coincide esattamente con il proprio.
function quickPeriodRanges(): QuickRange[] {
  const today = new Date(formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'12:00:00"))
  return [
    { key: 'oggi', label: 'Oggi', start: fmtDate(today), end: fmtDate(today) },
    { key: 'settimana', label: 'Settimana', start: fmtDate(startOfWeek(today, { weekStartsOn: 1 })), end: fmtDate(endOfWeek(today, { weekStartsOn: 1 })) },
    { key: 'mese', label: 'Mese', start: fmtDate(startOfMonth(today)), end: fmtDate(endOfMonth(today)) },
    { key: 'anno', label: 'Anno', start: fmtDate(startOfYear(today)), end: fmtDate(endOfYear(today)) },
  ]
}

type RigaJoined = Riga & { restaurant: { name: string } | null }

async function fetchRighe(
  supabase: ReturnType<typeof createClient>,
  targets: string[],
  start: string,
  end: string
): Promise<Riga[]> {
  if (targets.length === 0) return []
  const { data } = await supabase
    .from('cassa_chiusure')
    .select('id, data, restaurant_id, totale_entrate, totale_spese_giornaliere, differenza, coperti, incasso_asporto, entrate_contanti, entrate_pos, entrate_bonifico, stato, restaurant:restaurants(name)')
    .in('restaurant_id', targets)
    .eq('stato', 'confermata')
    .gte('data', start)
    .lte('data', end)
    .order('data', { ascending: false })

  return ((data ?? []) as unknown as RigaJoined[]).map(r => ({
    id: r.id,
    data: r.data,
    restaurant_id: r.restaurant_id,
    restaurant_name: r.restaurant?.name ?? '—',
    totale_entrate: r.totale_entrate,
    totale_spese_giornaliere: r.totale_spese_giornaliere,
    differenza: r.differenza,
    coperti: r.coperti,
    incasso_asporto: r.incasso_asporto,
    entrate_contanti: r.entrate_contanti,
    entrate_pos: r.entrate_pos,
    entrate_bonifico: r.entrate_bonifico,
  }))
}

interface SpesaRow {
  importo: number
  categoria_nome: string | null
  nome_spesa: string
  data: string
  restaurant_id: string
  restaurant_name: string
}

// chiusuraInfoById: data + locale della chiusura per ogni id, dalle righe
// già caricate — evita una join aggiuntiva solo per popolare il trend nel
// tempo e il drill-down per nome_spesa/locale nella ciambella categorie.
async function fetchSpese(
  supabase: ReturnType<typeof createClient>,
  chiusure: Riga[]
): Promise<SpesaRow[]> {
  if (chiusure.length === 0) return []
  const chiusuraInfoById = new Map(chiusure.map(r => [r.id, r]))
  const { data } = await supabase
    .from('cassa_spese')
    .select('importo, nome_spesa, chiusura_id, categoria:cassa_categorie(nome)')
    .in('chiusura_id', chiusure.map(r => r.id))

  return ((data ?? []) as unknown as Array<{ importo: number; nome_spesa: string; chiusura_id: string; categoria: { nome: string } | null }>).map(s => {
    const chiusura = chiusuraInfoById.get(s.chiusura_id)
    return {
      importo: s.importo,
      categoria_nome: s.categoria?.nome ?? null,
      nome_spesa: s.nome_spesa,
      data: chiusura?.data ?? '',
      restaurant_id: chiusura?.restaurant_id ?? '',
      restaurant_name: chiusura?.restaurant_name ?? '—',
    }
  })
}

export function AnalisiClient({ restaurants }: Props) {
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>([])
  // Default: mese corrente, stesso comportamento di prima senza bisogno di
  // un "preset" separato — vedi quickPeriodRanges più sotto.
  const [customStart, setCustomStart] = useState(() => {
    const today = new Date(formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'12:00:00"))
    return fmtDate(startOfMonth(today))
  })
  const [customEnd, setCustomEnd] = useState(() => {
    const today = new Date(formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'12:00:00"))
    return fmtDate(endOfMonth(today))
  })
  const [compareYoY, setCompareYoY] = useState(false)

  const [righe, setRighe] = useState<Riga[]>([])
  const [righePrecedenti, setRighePrecedenti] = useState<Riga[]>([])
  const [righePeriodoPrecedente, setRighePeriodoPrecedente] = useState<Riga[] | null>(null)
  const [spese, setSpese] = useState<SpesaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null)

  const quickPeriods = useMemo(() => quickPeriodRanges(), [])

  // Mese corrente + 3 precedenti, calcolati dalla data odierna — ogni
  // pillola imposta il range esatto 1°-ultimo giorno di quel mese
  // (endOfMonth gestisce da sé 28/29/30/31) direttamente su
  // customStart/customEnd.
  const quickMonths = useMemo(() => {
    const now = new Date(formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'12:00:00"))
    return Array.from({ length: 4 }, (_, i) => {
      const d = subMonths(now, i)
      const label = format(d, 'MMMM', { locale: it })
      return {
        key: format(d, 'yyyy-MM'),
        label: label.charAt(0).toUpperCase() + label.slice(1),
        start: fmtDate(startOfMonth(d)),
        end: fmtDate(endOfMonth(d)),
      }
    })
  }, [])

  const start = customStart
  const end = customEnd
  const targets = useMemo(
    () => selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id),
    [selectedRestaurants, restaurants]
  )
  const targetsKey = useMemo(() => JSON.stringify(targets), [targets])

  function handleExport(exportFormat: 'pdf' | 'xlsx') {
    setExporting(exportFormat)
  }

  // requestId: scarta le risposte di un fetch superato da uno più recente
  // (cambio filtro rapido, o un evento realtime arrivato durante un fetch
  // già in corso) invece di lasciarle sovrascrivere lo stato con dati vecchi.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (!start || !end) return
    const myRequest = ++requestId.current
    setLoading(true)

    const supabase = createClient()
    const current = await fetchRighe(supabase, targets, start, end)
    if (requestId.current !== myRequest) return
    setRighe(current)

    const speseData = await fetchSpese(supabase, current)
    if (requestId.current === myRequest) setSpese(speseData)

    // Periodo precedente equivalente (stessa durata, immediatamente prima)
    // per la variazione % nella riga KPI — indipendente dal confronto
    // anno-su-anno qui sotto, che riguarda invece il grafico andamento.
    const durationDays = differenceInCalendarDays(new Date(`${end}T12:00:00Z`), new Date(`${start}T12:00:00Z`)) + 1
    const kpiPrevEnd = fmtDate(subDays(new Date(`${start}T12:00:00Z`), 1))
    const kpiPrevStart = fmtDate(subDays(new Date(`${start}T12:00:00Z`), durationDays))
    const kpiPrevious = await fetchRighe(supabase, targets, kpiPrevStart, kpiPrevEnd)
    if (requestId.current === myRequest) setRighePeriodoPrecedente(kpiPrevious)

    if (compareYoY) {
      const prevStart = fmtDate(subYears(new Date(`${start}T12:00:00Z`), 1))
      const prevEnd = fmtDate(subYears(new Date(`${end}T12:00:00Z`), 1))
      const previous = await fetchRighe(supabase, targets, prevStart, prevEnd)
      if (requestId.current === myRequest) setRighePrecedenti(previous)
    } else {
      setRighePrecedenti([])
    }

    if (requestId.current === myRequest) setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, targetsKey, compareYoY])

  useEffect(() => { load() }, [load])

  // Riflette in tempo reale le chiusure modificate/create/eliminate altrove
  // (Lista Chiusure, wizard di modifica, approvazione richieste) senza
  // dover ricaricare la pagina — stesso pattern già usato nel resto
  // dell'app (canale postgres_changes su cassa_chiusure).
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('cassa_chiusure_analisi')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  return (
    <div className="space-y-4">
      {/* Filtri: prima cosa selezionabile in pagina, tutto il resto (KPI,
          giorno migliore/peggiore, grafici, export) dipende da questi. */}
      <Card className="cassa-perforated-top">
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label>Ristoranti</Label>
            <RestaurantMultiSelect restaurants={restaurants} selected={selectedRestaurants} onChange={setSelectedRestaurants} />
            {selectedRestaurants.length === 0 && (
              <p className="text-xs text-muted-foreground">Nessuno selezionato: mostro tutti i ristoranti.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Periodo</Label>
            <div className="flex flex-wrap gap-2">
              {quickPeriods.map(p => (
                <CassaPill
                  key={p.key}
                  active={customStart === p.start && customEnd === p.end}
                  onClick={() => { setCustomStart(p.start); setCustomEnd(p.end) }}
                >
                  {p.label}
                </CassaPill>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-auto cassa-numeric" />
              <span className="text-muted-foreground text-sm">→</span>
              <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-auto cassa-numeric" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground font-normal">Mese rapido</Label>
            <div className="flex flex-wrap gap-2">
              {quickMonths.map(m => (
                <CassaPill
                  key={m.key}
                  active={customStart === m.start && customEnd === m.end}
                  onClick={() => { setCustomStart(m.start); setCustomEnd(m.end) }}
                >
                  {m.label}
                </CassaPill>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={compareYoY}
              onChange={e => setCompareYoY(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Confronta con l&apos;anno precedente
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button" variant="outline" size="sm"
          disabled={righe.length === 0}
          onClick={() => handleExport('pdf')}
        >
          <FileText className="w-4 h-4" /> Esporta PDF
        </Button>
        <Button
          type="button" variant="outline" size="sm"
          disabled={righe.length === 0}
          onClick={() => handleExport('xlsx')}
        >
          <FileSpreadsheet className="w-4 h-4" /> Esporta Excel
        </Button>
      </div>

      <CassaFileViewer
        open={!!exporting}
        onOpenChange={open => { if (!open) setExporting(null) }}
        request={exporting ? { url: '/api/cassa/analisi-export', body: { restaurant_ids: targets, start, end, format: exporting } } : null}
        format={exporting}
        title={`Analisi · ${start} → ${end}`}
        fileNameBase={`analisi-cassa-${start}_${end}`}
      />

      {!loading && righe.length > 0 && (
        <>
          <AnalisiKpiRow righe={righe} righePeriodoPrecedente={righePeriodoPrecedente} />
          <BestWorstDayHighlight righe={righe} />
        </>
      )}

      {!loading && righe.length > 0 && <RecurringAlertsSection righe={righe} />}

      {!loading && righe.length > 0 && (
        <Card className="cassa-perforated-top">
          <CardContent className="pt-6 space-y-2">
            <Label className="cassa-display text-base">Confronto per ristorante nel periodo</Label>
            <ConfrontoSediTable righe={righe} />
          </CardContent>
        </Card>
      )}

      <Card className="cassa-perforated-top">
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              <div className="flex items-end gap-2 h-48">
                {[45, 65, 40, 80, 55, 70, 35, 60, 50, 75, 45, 65].map((h, i) => (
                  <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          ) : righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna chiusura confermata nel periodo selezionato.</p>
          ) : (
            <TrendChart righe={righe} righePrecedenti={compareYoY ? righePrecedenti : undefined} />
          )}
        </CardContent>
      </Card>

      {!loading && righe.length > 0 && (
        <Card className="cassa-perforated-top">
          <CardContent className="pt-6 space-y-3">
            <Label className="cassa-display text-base">Ripartizione entrate per tipo di pagamento</Label>
            <PagamentoBreakdownChart righe={righe} />
          </CardContent>
        </Card>
      )}

      {!loading && righe.length > 0 && (
        <Card className="cassa-perforated-top">
          <CardContent className="pt-6 space-y-3">
            <Label className="cassa-display text-base">Ripartizione spese per categoria</Label>
            <CategorieBreakdownChart spese={spese} multiRestaurant={targets.length > 1} />
          </CardContent>
        </Card>
      )}

      {!loading && righe.length > 0 && (
        <Card className="cassa-perforated-top">
          <CardContent className="pt-6 space-y-3">
            <Label className="cassa-display text-base">Spese per categoria nel tempo</Label>
            <CategorieTrendChart spese={spese} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
