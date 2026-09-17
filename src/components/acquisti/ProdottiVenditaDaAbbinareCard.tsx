'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Link2, EyeOff } from 'lucide-react'

interface CatalogoOption { id: string; nome_articolo: string }

interface ProdottoNonAbbinato {
  nome: string
  categoria: string | null
}

interface Props {
  restaurantId: string
}

// Come CHUNK_SIZE in AnalisiClient: con molte chiusure l'elenco di id in
// querystring (.in(...)) supera i limiti di URI del gateway Supabase.
const CHUNK_SIZE = 150

// Card visibile solo a manager/direttore (Inventario è già ristretto a
// questi ruoli, vedi acquisti/layout.tsx): elenca i nomi prodotto letti
// dai report di chiusura che non coincidono con nessun articolo
// tracciato E non hanno ancora una mappatura salvata — la maggior parte
// dei nomi del gestionale non coincide affatto con Inventario, quindi
// questa è la coda "da decidere una volta sola" (abbina_prodotto_venduto,
// vedi 20260916f_vendite_prodotti_mappature.sql). Una volta deciso (per
// un articolo o "non è un articolo di magazzino"), il nome non ricompare
// più — né qui né nello scarico automatico dei report successivi.
export function ProdottiVenditaDaAbbinareCard({ restaurantId }: Props) {
  const [loading, setLoading] = useState(true)
  const [daAbbinare, setDaAbbinare] = useState<ProdottoNonAbbinato[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoOption[]>([])
  const [scelto, setScelto] = useState<ProdottoNonAbbinato | null>(null)
  const [ricerca, setRicerca] = useState('')
  const [salvando, setSalvando] = useState<string | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!restaurantId) { setDaAbbinare([]); setLoading(false); return }
    setLoading(true)
    const supabase = createClient()

    // Niente embed su cassa_chiusure: prima gli id delle chiusure del
    // locale, poi le vendite per quegli id — stesso pattern già in uso
    // in AnalisiClient, più semplice e robusto di un filtro su tabella
    // annidata via PostgREST.
    const { data: chiusureRaw } = await supabase.from('cassa_chiusure').select('id').eq('restaurant_id', restaurantId)
    const chiusuraIds = (chiusureRaw ?? []).map(c => c.id as string)

    const chunks: string[][] = []
    for (let i = 0; i < chiusuraIds.length; i += CHUNK_SIZE) chunks.push(chiusuraIds.slice(i, i + CHUNK_SIZE))

    const [{ data: catalogoRaw }, venditeRisposte, { data: mappatureRaw }] = await Promise.all([
      supabase.from('catalogo_articoli').select('id, nome_articolo').eq('traccia_in_inventario', true).order('nome_articolo'),
      Promise.all(chunks.map(chunk => supabase.from('cassa_vendite_prodotti').select('nome_prodotto, nome_categoria').in('chiusura_id', chunk))),
      supabase.from('vendite_prodotti_mappature').select('nome_prodotto'),
    ])

    const catalogoOptions = (catalogoRaw ?? []) as CatalogoOption[]
    setCatalogo(catalogoOptions)

    const trackedNames = new Set(catalogoOptions.map(a => a.nome_articolo.trim().toLowerCase()))
    const mappedNames = new Set(((mappatureRaw ?? []) as Array<{ nome_prodotto: string }>).map(m => m.nome_prodotto.trim().toLowerCase()))

    const vendite = venditeRisposte.flatMap(r => (r.data ?? []) as Array<{ nome_prodotto: string; nome_categoria: string | null }>)
    const visti = new Set<string>()
    const coda: ProdottoNonAbbinato[] = []
    for (const v of vendite) {
      const chiave = v.nome_prodotto.trim().toLowerCase()
      if (trackedNames.has(chiave) || mappedNames.has(chiave) || visti.has(chiave)) continue
      visti.add(chiave)
      coda.push({ nome: v.nome_prodotto.trim(), categoria: v.nome_categoria })
    }
    coda.sort((a, b) => a.nome.localeCompare(b.nome))
    setDaAbbinare(coda)
    setLoading(false)
  }, [restaurantId])

  useEffect(() => { load() }, [load])

  function apri(p: ProdottoNonAbbinato) {
    setScelto(p)
    setRicerca('')
    setErrore(null)
  }

  async function decidi(catalogoArticoloId: string | null) {
    if (!scelto) return
    setSalvando(scelto.nome)
    setErrore(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('abbina_prodotto_venduto', {
      p_restaurant_id: restaurantId,
      p_nome_prodotto: scelto.nome,
      p_catalogo_articolo_id: catalogoArticoloId,
    })
    setSalvando(null)
    if (error) { setErrore(error.message); return }
    setDaAbbinare(prev => prev.filter(p => p.nome !== scelto.nome))
    setScelto(null)
  }

  const risultati = catalogo.filter(a => !ricerca.trim() || a.nome_articolo.toLowerCase().includes(ricerca.trim().toLowerCase()))

  if (!loading && daAbbinare.length === 0) return null

  return (
    <>
      <Card className="cassa-perforated-top">
        <CardHeader>
          <CardTitle className="cassa-display text-lg">Prodotti da abbinare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Nomi letti dai report di chiusura che non coincidono con nessun articolo tracciato. Abbinali una volta sola: da qui in poi lo scarico dall&apos;Inventario li riconosce da solo.
          </p>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : (
          <div className="divide-y divide-border">
            {daAbbinare.map(p => (
              <div key={p.nome} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.nome}</p>
                  {p.categoria && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mt-0.5">{p.categoria}</Badge>}
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => apri(p)}>
                  Abbina…
                </Button>
              </div>
            ))}
          </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!scelto} onOpenChange={o => { if (!salvando && !o) setScelto(null) }}>
        <DialogContent className="cassa-perforated-top">
          <DialogHeader>
            <DialogTitle className="cassa-display text-lg">{scelto?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={ricerca}
              onChange={e => setRicerca(e.target.value)}
              placeholder="Cerca articolo tracciato…"
              autoFocus
            />
            <div className="max-h-64 overflow-y-auto divide-y divide-border rounded-md border border-border">
              {risultati.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">Nessun articolo trovato.</p>
              ) : (
                risultati.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!!salvando}
                    onClick={() => decidi(a.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {a.nome_articolo}
                  </button>
                ))
              )}
            </div>
            <Button type="button" variant="outline" className="w-full gap-1.5" disabled={!!salvando} onClick={() => decidi(null)}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
              Non è un articolo di magazzino
            </Button>
            {errore && <p className="text-sm text-destructive">{errore}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
