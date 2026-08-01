'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArticoloPrezzoChart, type PuntoStorico } from '@/components/cassa/ArticoloPrezzoChart'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia } from '@/types'

const TIPOLOGIA_LABELS: Record<ArticoloTipologia, string> = {
  food: 'Food',
  beverage: 'Beverage',
  detergenza: 'Detergenza',
  altro_no_food: 'Altro no-food',
}

interface Props {
  fornitori: Array<{ id: string; nome: string }>
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
}

export function ArticoliClient({ fornitori }: Props) {
  const [fornitoreFiltro, setFornitoreFiltro] = useState<string>('')
  const [tipologiaFiltro, setTipologiaFiltro] = useState<ArticoloTipologia | ''>('')
  const [righe, setRighe] = useState<ArticoloRiga[]>([])
  const [loading, setLoading] = useState(true)
  const [espanso, setEspanso] = useState<string | null>(null)

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
      .select('catalogo_articolo_id, prezzo_unitario, fattura:fatture!inner(data)')
      .in('catalogo_articolo_id', rows.map(r => r.id))
      .order('data', { foreignTable: 'fatture', ascending: true })

    const storicoById = new Map<string, PuntoStorico[]>()
    for (const s of (storicoRaw ?? []) as unknown as Array<{ catalogo_articolo_id: string; prezzo_unitario: number; fattura: { data: string } | null }>) {
      if (!s.fattura) continue
      const arr = storicoById.get(s.catalogo_articolo_id) ?? []
      arr.push({ data: s.fattura.data, prezzo: s.prezzo_unitario })
      storicoById.set(s.catalogo_articolo_id, arr)
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
      }
    }))
    setLoading(false)
  }, [fornitoreFiltro, tipologiaFiltro])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('articoli_lista')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fatture_articoli' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalogo_articoli' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  return (
    <div className="space-y-4">
      <Card className="cassa-perforated-top">
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          ) : righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun articolo trovato.</p>
          ) : (
            <div className="divide-y divide-border">
              {righe.map(r => {
                const prezzoRecente = r.storico.at(-1)?.prezzo ?? null
                const aperto = espanso === r.id
                return (
                  <div key={r.id} className="py-2">
                    <button
                      type="button"
                      onClick={() => setEspanso(prev => prev === r.id ? null : r.id)}
                      aria-expanded={aperto}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        aperto ? 'bg-accent' : 'hover:bg-accent/60'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aperto && 'rotate-180')} />
                        <div className="min-w-0">
                          <p className={cn('text-sm font-medium', !aperto && 'truncate')}>{r.nome_articolo}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            {r.fornitore_nome}
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{TIPOLOGIA_LABELS[r.tipologia]}</Badge>
                          </p>
                        </div>
                      </div>
                      <div className="cassa-numeric text-sm shrink-0 whitespace-nowrap text-right">
                        {prezzoRecente != null ? (
                          <>€ {prezzoRecente.toFixed(2)}{r.unita_misura && <span className="text-muted-foreground text-xs"> / {r.unita_misura}</span>}</>
                        ) : (
                          <span className="text-muted-foreground text-xs">nessun acquisto</span>
                        )}
                      </div>
                    </button>
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
    </div>
  )
}
