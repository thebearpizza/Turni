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
import { CurrencyInput } from '@/components/ui/currency-input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArticoloPrezzoChart, type PuntoStorico } from '@/components/cassa/ArticoloPrezzoChart'
import { FatturaFotoViewer } from '@/components/cassa/FatturaFotoViewer'
import { ChevronDown, Eye, Loader2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia, RiquadroArticolo } from '@/types'

const TZ = 'Europe/Rome'

const TIPOLOGIA_LABELS: Record<ArticoloTipologia, string> = {
  food: 'Food',
  beverage: 'Beverage',
  detergenza: 'Detergenza',
  altro_no_food: 'Altro no-food',
}

interface Props {
  fornitori: Array<{ id: string; nome: string }>
}

// L'acquisto più recente di un articolo — serve sia per aprire il
// documento sorgente (icona occhio) sia per sapere quale riga
// fatture_articoli aggiornare quando si corregge il prezzo (icona
// matita): solo l'ultimo acquisto è modificabile, non l'intero storico.
interface UltimoAcquisto {
  fatturaArticoloId: string
  fotoPaths: string[]
  numeroDocumento: string
  data: string
  quantita: number
  // Per evidenziare il prodotto nella foto d'origine (icona occhio):
  // null sugli acquisti registrati prima di questo campo, o quando l'AI
  // non è riuscita a stimare il riquadro — in quel caso si mostra la
  // foto come sempre, senza overlay.
  paginaIndice: number | null
  riquadro: RiquadroArticolo | null
}

interface ArticoloRiga {
  id: string
  nome_articolo: string
  tipologia: ArticoloTipologia
  unita_misura: string | null
  fattore_conversione: number
  fornitore_id: string
  fornitore_nome: string
  storico: PuntoStorico[] // ordinato per data crescente, prezzo già normalizzato
  ultimoAcquisto: UltimoAcquisto | null
}

export function ArticoliClient({ fornitori }: Props) {
  const [ricerca, setRicerca] = useState('')
  const [fornitoreFiltro, setFornitoreFiltro] = useState<string>('')
  const [tipologiaFiltro, setTipologiaFiltro] = useState<ArticoloTipologia | ''>('')
  const [righe, setRighe] = useState<ArticoloRiga[]>([])
  const [loading, setLoading] = useState(true)
  const [espanso, setEspanso] = useState<string | null>(null)
  const [viewerRiga, setViewerRiga] = useState<ArticoloRiga | null>(null)
  const [modifica, setModifica] = useState<ArticoloRiga | null>(null)
  const [prezzoModifica, setPrezzoModifica] = useState(0)
  const [unitaModifica, setUnitaModifica] = useState('')
  const [salvandoModifica, setSalvandoModifica] = useState(false)
  const [erroreModifica, setErroreModifica] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from('catalogo_articoli')
      .select('id, nome_articolo, tipologia, unita_misura, fattore_conversione, fornitore_id, fornitore:fornitori(nome)')
      .order('nome_articolo')
    if (fornitoreFiltro) query = query.eq('fornitore_id', fornitoreFiltro)
    if (tipologiaFiltro) query = query.eq('tipologia', tipologiaFiltro)

    const { data: catalogo } = await query
    const rows = (catalogo ?? []) as unknown as Array<{
      id: string; nome_articolo: string; tipologia: ArticoloTipologia
      unita_misura: string | null; fattore_conversione: number
      fornitore_id: string; fornitore: { nome: string } | null
    }>

    if (rows.length === 0) { setRighe([]); setLoading(false); return }

    const { data: storicoRaw } = await supabase
      .from('fatture_articoli')
      .select('id, catalogo_articolo_id, prezzo_unitario, quantita, pagina_indice, riquadro, fattura:fatture!inner(data, foto_paths, numero_documento)')
      .in('catalogo_articolo_id', rows.map(r => r.id))
      .order('data', { foreignTable: 'fatture', ascending: true })

    const storicoById = new Map<string, PuntoStorico[]>()
    // Ordinato per data crescente: l'ultima riga scritta per ciascun
    // articolo, sovrascrivendo la precedente, è sempre l'acquisto più
    // recente — stesso criterio già usato per prezzoRecente (storico.at(-1)).
    const ultimoAcquistoById = new Map<string, UltimoAcquisto>()
    for (const s of (storicoRaw ?? []) as unknown as Array<{
      id: string; catalogo_articolo_id: string; prezzo_unitario: number; quantita: number
      pagina_indice: number | null; riquadro: RiquadroArticolo | null
      fattura: { data: string; foto_paths: string[]; numero_documento: string } | null
    }>) {
      if (!s.fattura) continue
      const arr = storicoById.get(s.catalogo_articolo_id) ?? []
      arr.push({ data: s.fattura.data, prezzo: s.prezzo_unitario })
      storicoById.set(s.catalogo_articolo_id, arr)
      ultimoAcquistoById.set(s.catalogo_articolo_id, {
        fatturaArticoloId: s.id,
        fotoPaths: s.fattura.foto_paths,
        numeroDocumento: s.fattura.numero_documento,
        paginaIndice: s.pagina_indice,
        riquadro: s.riquadro,
        data: s.fattura.data,
        quantita: s.quantita,
      })
    }

    setRighe(rows.map(r => {
      const storicoGrezzo = storicoById.get(r.id) ?? []
      const fattore = r.fattore_conversione || 1
      return {
        id: r.id,
        nome_articolo: r.nome_articolo,
        tipologia: r.tipologia,
        unita_misura: r.unita_misura,
        fattore_conversione: fattore,
        fornitore_id: r.fornitore_id,
        fornitore_nome: r.fornitore?.nome ?? '—',
        // Normalizzato secondo il fattore di conversione (Task 4): stesso
        // fattore fisso per tutto lo storico di questa coppia articolo+fornitore.
        storico: storicoGrezzo.map(p => ({ data: p.data, prezzo: p.prezzo / fattore })),
        ultimoAcquisto: ultimoAcquistoById.get(r.id) ?? null,
      }
    }))
    setLoading(false)
  }, [fornitoreFiltro, tipologiaFiltro])

  useEffect(() => { load() }, [load])

  const righeFiltrate = ricerca.trim()
    ? righe.filter(r => r.nome_articolo.toLowerCase().includes(ricerca.trim().toLowerCase()))
    : righe

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('articoli_lista')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fatture_articoli' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalogo_articoli' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  function apriModifica(r: ArticoloRiga) {
    setModifica(r)
    setPrezzoModifica(r.storico.at(-1)?.prezzo ?? 0)
    setUnitaModifica(r.unita_misura ?? '')
    setErroreModifica(null)
  }

  // Il prezzo mostrato/modificato è quello normalizzato (vedi storico più
  // sopra): va riconvertito nel grezzo secondo lo stesso fattore prima di
  // scriverlo su fatture_articoli, che conserva sempre il valore originale.
  async function salvaModifica() {
    if (!modifica) return
    setSalvandoModifica(true)
    setErroreModifica(null)
    const supabase = createClient()

    const { error: errUnita } = await supabase
      .from('catalogo_articoli')
      .update({ unita_misura: unitaModifica.trim() || null })
      .eq('id', modifica.id)
    if (errUnita) {
      setErroreModifica(errUnita.message)
      setSalvandoModifica(false)
      return
    }

    if (modifica.ultimoAcquisto) {
      const prezzoUnitarioGrezzo = prezzoModifica * modifica.fattore_conversione
      const { error: errPrezzo } = await supabase
        .from('fatture_articoli')
        .update({
          prezzo_unitario: prezzoUnitarioGrezzo,
          prezzo_riga: prezzoUnitarioGrezzo * modifica.ultimoAcquisto.quantita,
        })
        .eq('id', modifica.ultimoAcquisto.fatturaArticoloId)
      if (errPrezzo) {
        setErroreModifica(errPrezzo.message)
        setSalvandoModifica(false)
        return
      }
    }

    setSalvandoModifica(false)
    setModifica(null)
    await load()
  }

  return (
    <div className="space-y-4">
      <Card className="cassa-perforated-top">
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Cerca</Label>
            <Input
              value={ricerca}
              onChange={e => setRicerca(e.target.value)}
              placeholder="Nome articolo…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fornitore</Label>
            <Select value={fornitoreFiltro || '__tutti__'} onValueChange={v => setFornitoreFiltro(v === '__tutti__' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__tutti__">Tutti i fornitori</SelectItem>
                {fornitori.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
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
          ) : righeFiltrate.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun articolo trovato.</p>
          ) : (
            <div className="divide-y divide-border">
              {righeFiltrate.map(r => {
                const prezzoRecente = r.storico.at(-1)?.prezzo ?? null
                const aperto = espanso === r.id
                return (
                  <div key={r.id} className="py-2">
                    <div
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors',
                        aperto ? 'bg-accent' : 'hover:bg-accent/60'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setEspanso(prev => prev === r.id ? null : r.id)}
                        aria-expanded={aperto}
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                        )}
                      >
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aperto && 'rotate-180')} />
                        <div className="min-w-0">
                          <p className={cn('text-sm font-medium', !aperto && 'truncate')}>{r.nome_articolo}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            {r.fornitore_nome}
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{TIPOLOGIA_LABELS[r.tipologia]}</Badge>
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <div className="cassa-numeric text-sm whitespace-nowrap text-right pr-1">
                          {prezzoRecente != null ? (
                            <>€ {prezzoRecente.toFixed(2)}{r.unita_misura && <span className="text-muted-foreground text-xs"> / {r.unita_misura}</span>}</>
                          ) : (
                            <span className="text-muted-foreground text-xs">nessun acquisto</span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Vedi documento"
                          disabled={!r.ultimoAcquisto}
                          onClick={() => setViewerRiga(r)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Modifica prezzo e unità di misura"
                          onClick={() => apriModifica(r)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {aperto && (
                      <div className="px-2 pb-2 pt-1">
                        <ArticoloPrezzoChart storico={r.storico} unitaMisura={r.unita_misura} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <FatturaFotoViewer
        open={!!viewerRiga}
        onOpenChange={open => { if (!open) setViewerRiga(null) }}
        fotoPaths={viewerRiga?.ultimoAcquisto?.fotoPaths ?? []}
        title={
          viewerRiga?.ultimoAcquisto
            ? `${viewerRiga.fornitore_nome} · Doc. ${viewerRiga.ultimoAcquisto.numeroDocumento} · ${formatInTimeZone(`${viewerRiga.ultimoAcquisto.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })}`
            : ''
        }
        evidenzia={
          viewerRiga?.ultimoAcquisto?.paginaIndice != null && viewerRiga.ultimoAcquisto.riquadro
            ? { paginaIndice: viewerRiga.ultimoAcquisto.paginaIndice, riquadro: viewerRiga.ultimoAcquisto.riquadro }
            : null
        }
      />

      <Dialog
        open={!!modifica}
        onOpenChange={o => { if (!salvandoModifica && !o) { setModifica(null); setErroreModifica(null) } }}
      >
        <DialogContent className="cassa-perforated-top">
          <DialogHeader>
            <DialogTitle className="cassa-display text-lg">{modifica?.nome_articolo}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Prezzo ultimo acquisto</Label>
              {modifica?.ultimoAcquisto ? (
                <CurrencyInput value={prezzoModifica} onChange={setPrezzoModifica} className="cassa-numeric" />
              ) : (
                <p className="text-sm text-muted-foreground">Nessun acquisto registrato per questo articolo.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Unità di misura</Label>
              <Input value={unitaModifica} onChange={e => setUnitaModifica(e.target.value)} placeholder="Es. kg, L, pz" />
            </div>
            {erroreModifica && <p className="text-sm text-destructive">{erroreModifica}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModifica(null)} disabled={salvandoModifica}>
              Annulla
            </Button>
            <Button type="button" onClick={salvaModifica} disabled={salvandoModifica}>
              {salvandoModifica ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvataggio…</> : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
