'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronDown, Loader2, Minus, Pencil, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia, InventarioCausale } from '@/types'

const TZ = 'Europe/Rome'

const TIPOLOGIA_LABELS: Record<ArticoloTipologia, string> = {
  food: 'Food',
  beverage: 'Beverage',
  detergenza: 'Detergenza',
  altro_no_food: 'Altro no-food',
}

const CAUSALE_LABELS: Record<InventarioCausale, string> = {
  carico_manuale: 'Carico manuale',
  scarico_manuale: 'Scarico manuale',
  rettifica: 'Rettifica',
  fattura: 'Da fattura',
  chiusura_cassa: 'Da chiusura cassa',
}

interface RestaurantOption { id: string; name: string }

// Un "gruppo" accorpa tutte le righe del catalogo con lo stesso nome
// esatto (accorpamento automatico per nome uguale, scelto esplicitamente
// invece di un accorpamento manuale — nomi che differiscono anche di
// poco, es. maiuscole o spazi, restano righe separate): lo stesso
// prodotto comprato da fornitori diversi è una riga sola in Inventario,
// pur restando righe distinte nel catalogo (storico prezzi per
// fornitore invariato in Articoli). I nuovi movimenti si agganciano
// sempre al primo membro del gruppo (ordine stabile): la giacenza
// mostrata è comunque la somma su tutti i membri, quindi il totale
// resta corretto indipendentemente da quale membro riceve il movimento.
interface ArticoloRiga {
  nomeArticolo: string
  tipologia: ArticoloTipologia
  unitaMisura: string | null
  fornitoriNomi: string[]
  memberIds: string[]
  primaryId: string
  giacenza: number
}

interface MovimentoRiga {
  id: string
  quantita: number
  causale: InventarioCausale
  nota: string | null
  created_at: string
  autore_nome: string | null
}

interface Props {
  role: 'manager' | 'direttore'
  restaurants: RestaurantOption[]
}

export function InventarioClient({ role, restaurants }: Props) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '')
  const [ricerca, setRicerca] = useState('')
  const [tipologiaFiltro, setTipologiaFiltro] = useState<ArticoloTipologia | ''>('')
  const [righe, setRighe] = useState<ArticoloRiga[]>([])
  const [loading, setLoading] = useState(true)
  const [espanso, setEspanso] = useState<string | null>(null)
  const [storicoPerGruppo, setStoricoPerGruppo] = useState<Record<string, MovimentoRiga[]>>({})
  const [caricandoStorico, setCaricandoStorico] = useState<string | null>(null)

  // Un'unica scheda "Modifica" per riga (aperta dalla matitina): logga
  // un movimento (se la quantità non è vuota) e/o aggiorna l'unità di
  // misura — non due azioni separate, per non affollare la riga di
  // icone diverse.
  const [modifica, setModifica] = useState<ArticoloRiga | null>(null)
  const [direzione, setDirezioneRaw] = useState<'carico' | 'scarico'>('carico')
  const [quantita, setQuantita] = useState('')
  const [causale, setCausale] = useState<InventarioCausale>('carico_manuale')
  const [nota, setNota] = useState('')
  const [unitaInput, setUnitaInput] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!restaurantId) { setRighe([]); setLoading(false); return }
    setLoading(true)
    const supabase = createClient()

    const { data: catalogo } = await supabase
      .from('catalogo_articoli')
      .select('id, nome_articolo, tipologia, unita_misura, fornitore:fornitori(nome)')
      .eq('traccia_in_inventario', true)
      .order('nome_articolo')
    const articoli = (catalogo ?? []) as unknown as Array<{
      id: string; nome_articolo: string; tipologia: ArticoloTipologia
      unita_misura: string | null; fornitore: { nome: string } | null
    }>

    if (articoli.length === 0) { setRighe([]); setLoading(false); return }

    const { data: giacenzeRaw } = await supabase
      .from('inventario_giacenze')
      .select('catalogo_articolo_id, giacenza')
      .eq('restaurant_id', restaurantId)
      .in('catalogo_articolo_id', articoli.map(a => a.id))
    const giacenzaById = new Map<string, number>(
      ((giacenzeRaw ?? []) as Array<{ catalogo_articolo_id: string; giacenza: number }>)
        .map(g => [g.catalogo_articolo_id, g.giacenza])
    )

    // Accorpamento per nome esatto (trim, case-sensitive) — vedi il
    // commento sull'interfaccia ArticoloRiga più sopra.
    const gruppi = new Map<string, typeof articoli>()
    for (const a of articoli) {
      const chiave = a.nome_articolo.trim()
      const arr = gruppi.get(chiave) ?? []
      arr.push(a)
      gruppi.set(chiave, arr)
    }

    setRighe(Array.from(gruppi.entries()).map(([nome, membri]) => ({
      nomeArticolo: nome,
      tipologia: membri[0].tipologia,
      unitaMisura: membri.find(m => m.unita_misura)?.unita_misura ?? null,
      fornitoriNomi: Array.from(new Set(membri.map(m => m.fornitore?.nome ?? '—'))),
      memberIds: membri.map(m => m.id),
      primaryId: membri[0].id,
      giacenza: membri.reduce((tot, m) => tot + (giacenzaById.get(m.id) ?? 0), 0),
    })).sort((a, b) => a.nomeArticolo.localeCompare(b.nomeArticolo)))
    setLoading(false)
  }, [restaurantId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!restaurantId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`inventario_lista_${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario_movimenti', filter: `restaurant_id=eq.${restaurantId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalogo_articoli' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [restaurantId, load])

  const righeFiltrate = righe
    .filter(r => !tipologiaFiltro || r.tipologia === tipologiaFiltro)
    .filter(r => !ricerca.trim() || r.nomeArticolo.toLowerCase().includes(ricerca.trim().toLowerCase()))

  async function caricaStorico(r: ArticoloRiga) {
    if (storicoPerGruppo[r.nomeArticolo] || !restaurantId) return
    setCaricandoStorico(r.nomeArticolo)
    const supabase = createClient()
    const { data } = await supabase
      .from('inventario_movimenti')
      .select('id, quantita, causale, nota, created_at, autore:profiles(full_name)')
      .eq('restaurant_id', restaurantId)
      .in('catalogo_articolo_id', r.memberIds)
      .order('created_at', { ascending: false })
      .limit(30)
    const righeStorico = ((data ?? []) as unknown as Array<{
      id: string; quantita: number; causale: InventarioCausale; nota: string | null
      created_at: string; autore: { full_name: string } | null
    }>).map(m => ({
      id: m.id, quantita: m.quantita, causale: m.causale, nota: m.nota,
      created_at: m.created_at, autore_nome: m.autore?.full_name ?? null,
    }))
    setStoricoPerGruppo(prev => ({ ...prev, [r.nomeArticolo]: righeStorico }))
    setCaricandoStorico(null)
  }

  function toggleEspanso(r: ArticoloRiga) {
    setEspanso(prev => {
      const next = prev === r.nomeArticolo ? null : r.nomeArticolo
      if (next) caricaStorico(r)
      return next
    })
  }

  // Cambiare direzione porta con sé la causale di default corrispondente,
  // ma solo se non era già su "Rettifica" (valida in entrambi i casi).
  function setDirezione(d: 'carico' | 'scarico') {
    setDirezioneRaw(d)
    setCausale(prev => prev === 'rettifica' ? prev : (d === 'carico' ? 'carico_manuale' : 'scarico_manuale'))
  }

  function apriModifica(r: ArticoloRiga) {
    setModifica(r)
    setDirezioneRaw('carico')
    setCausale('carico_manuale')
    setQuantita('')
    setNota('')
    setUnitaInput(r.unitaMisura ?? '')
    setErrore(null)
  }

  function passo(delta: number) {
    const attuale = Number(quantita.replace(',', '.')) || 0
    const next = Math.max(0, attuale + delta)
    setQuantita(next % 1 === 0 ? String(next) : String(Number(next.toFixed(2))))
  }

  async function salvaModifica() {
    if (!modifica || !restaurantId) return
    const qty = quantita.trim() ? Number(quantita.replace(',', '.')) : 0
    if (quantita.trim() && (!qty || qty <= 0)) { setErrore('La quantità deve essere maggiore di zero.'); return }

    setSalvando(true)
    setErrore(null)
    const supabase = createClient()

    if (qty > 0) {
      const { data: { user } } = await supabase.auth.getUser()
      const { error: errMov } = await supabase.from('inventario_movimenti').insert({
        restaurant_id: restaurantId,
        catalogo_articolo_id: modifica.primaryId,
        quantita: direzione === 'carico' ? qty : -qty,
        causale,
        nota: nota.trim() || null,
        created_by: user?.id ?? null,
      })
      if (errMov) {
        setErrore(errMov.message)
        setSalvando(false)
        return
      }
    }

    // Aggiorna l'unità su TUTTI i membri del gruppo (tutte le righe di
    // catalogo con questo nome, indipendentemente dal fornitore): qui
    // il prodotto è uno solo, tenerle disallineate confonderebbe la
    // prossima volta che si accorpano.
    const { error: errUnita } = await supabase
      .from('catalogo_articoli')
      .update({ unita_misura: unitaInput.trim() || null })
      .in('id', modifica.memberIds)
    if (errUnita) {
      setErrore(errUnita.message)
      setSalvando(false)
      return
    }

    setSalvando(false)
    setModifica(null)
    setStoricoPerGruppo(prev => {
      const next = { ...prev }
      delete next[modifica.nomeArticolo]
      return next
    })
    await load()
  }

  const opzioniCausale: InventarioCausale[] = direzione === 'carico'
    ? ['carico_manuale', 'rettifica']
    : ['scarico_manuale', 'rettifica']

  return (
    <div className="space-y-4">
      <Card className="cassa-perforated-top">
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {role === 'manager' && restaurants.length > 1 && (
            <div className="space-y-1.5">
              <Label>Ristorante</Label>
              <Select value={restaurantId} onValueChange={setRestaurantId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {restaurants.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Cerca</Label>
            <Input
              value={ricerca}
              onChange={e => setRicerca(e.target.value)}
              placeholder="Nome articolo…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tipologia</Label>
            <Select value={tipologiaFiltro || '__tutte__'} onValueChange={v => setTipologiaFiltro(v === '__tutte__' ? '' : v as ArticoloTipologia)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__tutte__">Tutte le tipologie</SelectItem>
                {(Object.keys(TIPOLOGIA_LABELS) as ArticoloTipologia[]).map(t => (
                  <SelectItem key={t} value={t}>{TIPOLOGIA_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="cassa-perforated-top">
        <CardContent className="pt-6">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-3">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun articolo tracciato. Vai su Articoli e attiva &ldquo;Traccia in Inventario&rdquo; su quelli che vuoi seguire qui.
            </p>
          ) : righeFiltrate.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun articolo trovato.</p>
          ) : (
            <div className="divide-y divide-border">
              {righeFiltrate.map(r => {
                const aperto = espanso === r.nomeArticolo
                const storico = storicoPerGruppo[r.nomeArticolo]
                return (
                  <div key={r.nomeArticolo} className="py-2">
                    <div
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors',
                        aperto ? 'bg-accent' : 'hover:bg-accent/60'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleEspanso(r)}
                        aria-expanded={aperto}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      >
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aperto && 'rotate-180')} />
                        <div className="min-w-0">
                          <p className={cn('text-sm font-medium break-words', !aperto && 'line-clamp-2')}>{r.nomeArticolo}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            {aperto && <span className="truncate">{r.fornitoriNomi.join(' · ')}</span>}
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{TIPOLOGIA_LABELS[r.tipologia]}</Badge>
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <div className="cassa-numeric text-sm whitespace-nowrap text-right pr-1">
                          {r.giacenza}{r.unitaMisura && <span className="text-muted-foreground text-xs"> {r.unitaMisura}</span>}
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Modifica" onClick={() => apriModifica(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {aperto && (
                      <div className="px-2 pb-2 pt-1">
                        {caricandoStorico === r.nomeArticolo ? (
                          <Skeleton className="h-16 w-full" />
                        ) : !storico || storico.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">Nessun movimento registrato.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {storico.map(m => (
                              <div key={m.id} className="flex items-center justify-between gap-2 text-xs border-b border-border/60 py-1.5 last:border-0">
                                <div className="min-w-0">
                                  <p>
                                    <span className={cn('cassa-numeric font-semibold', m.quantita > 0 ? 'text-[hsl(var(--cassa-positive))]' : 'text-[hsl(var(--cassa-negative))]')}>
                                      {m.quantita > 0 ? '+' : ''}{m.quantita}
                                    </span>
                                    <span className="text-muted-foreground"> · {CAUSALE_LABELS[m.causale]}</span>
                                  </p>
                                  {m.nota && <p className="text-muted-foreground truncate">{m.nota}</p>}
                                </div>
                                <div className="shrink-0 text-right text-muted-foreground">
                                  <p>{formatInTimeZone(m.created_at, TZ, 'dd/MM/yyyy HH:mm', { locale: it })}</p>
                                  {m.autore_nome && <p>{m.autore_nome}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!modifica}
        onOpenChange={o => { if (!salvando && !o) { setModifica(null); setErrore(null) } }}
      >
        <DialogContent className="cassa-perforated-top">
          <DialogHeader>
            <DialogTitle className="cassa-display text-lg">{modifica?.nomeArticolo}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2">
              <Button type="button" variant={direzione === 'carico' ? 'default' : 'outline'} className="flex-1" onClick={() => setDirezione('carico')}>
                Carico
              </Button>
              <Button type="button" variant={direzione === 'scarico' ? 'default' : 'outline'} className="flex-1" onClick={() => setDirezione('scarico')}>
                Scarico
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Quantità{modifica?.unitaMisura ? ` (${modifica.unitaMisura})` : ''}</Label>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => passo(-1)}>
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  inputMode="decimal"
                  value={quantita}
                  onChange={e => setQuantita(e.target.value)}
                  placeholder="0"
                  className="cassa-numeric text-center"
                />
                <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => passo(1)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Lascia vuoto per non registrare nessun movimento.</p>
            </div>

            {quantita.trim() !== '' && (
              <div className="space-y-1.5">
                <Label>Causale</Label>
                <Select value={causale} onValueChange={v => setCausale(v as InventarioCausale)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {opzioniCausale.map(c => <SelectItem key={c} value={c}>{CAUSALE_LABELS[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {quantita.trim() !== '' && (
              <div className="space-y-1.5">
                <Label>Nota (facoltativa)</Label>
                <Textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} />
              </div>
            )}

            <div className="space-y-1.5 border-t border-border pt-3">
              <Label>Unità di misura</Label>
              <Input value={unitaInput} onChange={e => setUnitaInput(e.target.value)} placeholder="Es. kg, L, pz" />
              {modifica && modifica.memberIds.length > 1 && (
                <p className="text-xs text-muted-foreground">Aggiorna tutti i fornitori di questo prodotto ({modifica.fornitoriNomi.join(', ')}).</p>
              )}
            </div>

            {errore && <p className="text-sm text-destructive">{errore}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModifica(null)} disabled={salvando}>
              Annulla
            </Button>
            <Button type="button" onClick={salvaModifica} disabled={salvando}>
              {salvando ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvataggio…</> : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
