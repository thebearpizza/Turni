'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import { Eye, Merge, Loader2, Pencil, Check, X } from 'lucide-react'
import type { ArticoloTipologia } from '@/types'

const TZ = 'Europe/Rome'

const TIPOLOGIA_LABELS: Record<ArticoloTipologia, string> = {
  food: 'Food',
  beverage: 'Beverage',
  detergenza: 'Detergenza',
  altro_no_food: 'Altro no-food',
}

function monthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, m, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

interface RiepilogoRiga {
  id: string
  nome: string
  partita_iva: string | null
  numero_fatture: number
  totale_periodo: number
  numero_articoli: number
}

interface FatturaRiga {
  id: string
  numero_documento: string
  data: string
  totale_lordo: number
  ha_articoli: boolean
}

interface ArticoloRiga {
  id: string
  nome_articolo: string
  tipologia: ArticoloTipologia
  unita_misura: string | null
  prezzo_corrente: number | null
}

interface Props {
  canEdit: boolean
}

// Elenco fornitori (Task 1): riepilogo aggregato via RPC
// fornitori_riepilogo (numero fatture, spesa nel periodo, articoli a
// catalogo — la RLS di fatture/catalogo_articoli scopa già i conteggi
// secondo il ruolo di chi chiama, manager vede tutto il proprio owner,
// direttore solo il proprio ristorante). Il dettaglio (anagrafica,
// fatture, catalogo con prezzo corrente) si apre in un dialog separato,
// caricato solo quando serve. canEdit=false (cassiere/direttore) nasconde
// modifica anagrafica e unione — sola lettura, come da requisito.
export function FornitoriClient({ canEdit }: Props) {
  const [month, setMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [righe, setRighe] = useState<RiepilogoRiga[]>([])
  const [loading, setLoading] = useState(true)
  const [ricerca, setRicerca] = useState('')

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const { start, end } = monthRange(month)
    const { data } = await supabase.rpc('fornitori_riepilogo', { p_periodo_inizio: start, p_periodo_fine: end })
    setRighe((data ?? []) as RiepilogoRiga[])
    setLoading(false)
  }

  useEffect(() => { load() }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  const righeFiltrate = ricerca.trim()
    ? righe.filter(r => r.nome.toLowerCase().includes(ricerca.trim().toLowerCase()))
    : righe

  const [dettaglioId, setDettaglioId] = useState<string | null>(null)
  const [unisciDaId, setUnisciDaId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="space-y-1.5 flex-1">
          <Label>Cerca fornitore</Label>
          <Input value={ricerca} onChange={e => setRicerca(e.target.value)} placeholder="Ragione sociale…" />
        </div>
        <div className="space-y-1.5">
          <Label>Periodo</Label>
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-auto cassa-numeric" />
        </div>
      </div>

      <div className="space-y-2">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-md border border-border px-4 py-3">
            <Skeleton className="h-4 w-48 mb-2" />
            <Skeleton className="h-3 w-72" />
          </div>
        ))}

        {!loading && righeFiltrate.length === 0 && (
          <p className="text-sm text-muted-foreground">Nessun fornitore trovato.</p>
        )}

        {!loading && righeFiltrate.map(r => (
          <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium truncate">{r.nome}</p>
              <p className="text-xs text-muted-foreground">{r.partita_iva ?? 'P.IVA non censita'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Badge variant="secondary">{r.numero_fatture} {r.numero_fatture === 1 ? 'fattura' : 'fatture'}</Badge>
              <Badge variant="secondary" className="cassa-numeric">€ {r.totale_periodo.toFixed(2)} nel mese</Badge>
              <Badge variant="secondary">{r.numero_articoli} a catalogo</Badge>
              <Button type="button" variant="outline" size="sm" onClick={() => setDettaglioId(r.id)}>
                <Eye className="h-4 w-4" /> Dettagli
              </Button>
              {canEdit && (
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Unisci con un altro fornitore" onClick={() => setUnisciDaId(r.id)}>
                  <Merge className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {dettaglioId && (
        <FornitoreDettaglioDialog
          fornitoreId={dettaglioId}
          canEdit={canEdit}
          onClose={() => setDettaglioId(null)}
          onSaved={() => load()}
        />
      )}

      {unisciDaId && (
        <UnisciFornitoreDialog
          fornitoreDaId={unisciDaId}
          fornitori={righe.filter(r => r.id !== unisciDaId).map(r => ({ id: r.id, nome: r.nome }))}
          nomeDa={righe.find(r => r.id === unisciDaId)?.nome ?? ''}
          onClose={() => setUnisciDaId(null)}
          onDone={() => { setUnisciDaId(null); load() }}
        />
      )}
    </div>
  )
}

interface DettaglioProps {
  fornitoreId: string
  canEdit: boolean
  onClose: () => void
  onSaved: () => void
}

function FornitoreDettaglioDialog({ fornitoreId, canEdit, onClose, onSaved }: DettaglioProps) {
  const [loading, setLoading] = useState(true)
  const [nome, setNome] = useState('')
  const [partitaIva, setPartitaIva] = useState('')
  const [fatture, setFatture] = useState<FatturaRiga[]>([])
  const [articoli, setArticoli] = useState<ArticoloRiga[]>([])
  const [editando, setEditando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let attivo = true
    setLoading(true)
    const supabase = createClient()
    Promise.all([
      supabase.from('fornitori').select('nome, partita_iva').eq('id', fornitoreId).single(),
      supabase.from('fatture').select('id, numero_documento, data, totale_lordo, ha_articoli').eq('fornitore_id', fornitoreId).order('data', { ascending: false }),
      supabase.rpc('fornitore_catalogo_con_prezzo', { p_fornitore_id: fornitoreId }),
    ]).then(([f, ft, ca]) => {
      if (!attivo) return
      setNome(f.data?.nome ?? '')
      setPartitaIva(f.data?.partita_iva ?? '')
      setFatture((ft.data ?? []) as FatturaRiga[])
      setArticoli((ca.data ?? []) as ArticoloRiga[])
      setLoading(false)
    })
    return () => { attivo = false }
  }, [fornitoreId])

  async function salvaAnagrafica() {
    if (!nome.trim()) { setError('Il nome non può essere vuoto.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('fornitori')
      .update({ nome: nome.trim(), partita_iva: partitaIva.trim() || null })
      .eq('id', fornitoreId)
    setSaving(false)
    if (err) { setError(friendlySaveError(err)); return }
    setEditando(false)
    onSaved()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="cassa acquisti cassa-perforated-top max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">{loading ? 'Fornitore' : nome}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3 rounded-lg border border-border p-3">
              {editando ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Ragione sociale</Label>
                    <Input value={nome} onChange={e => setNome(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Partita IVA</Label>
                    <Input value={partitaIva} onChange={e => setPartitaIva(e.target.value)} />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setEditando(false); setError(null) }} disabled={saving}>
                      <X className="h-4 w-4" /> Annulla
                    </Button>
                    <Button type="button" size="sm" onClick={salvaAnagrafica} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Ragione sociale: </span>{nome}</p>
                    <p><span className="text-muted-foreground">Partita IVA: </span>{partitaIva || '—'}</p>
                  </div>
                  {canEdit && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditando(true)}>
                      <Pencil className="h-4 w-4" /> Modifica
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Fatture ({fatture.length})</p>
              {fatture.length === 0 && <p className="text-sm text-muted-foreground">Nessuna fattura registrata.</p>}
              {fatture.map(f => (
                <div key={f.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span>Doc. {f.numero_documento} · {formatInTimeZone(`${f.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })}</span>
                  <span className="cassa-numeric">€ {f.totale_lordo.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Articoli a catalogo ({articoli.length})</p>
              {articoli.length === 0 && <p className="text-sm text-muted-foreground">Nessun articolo a catalogo.</p>}
              {articoli.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1 break-words">
                    <span>{a.nome_articolo}</span>
                    <span className="text-muted-foreground ml-2">({TIPOLOGIA_LABELS[a.tipologia]}{a.unita_misura ? `, ${a.unita_misura}` : ''})</span>
                  </div>
                  <span className="cassa-numeric shrink-0">{a.prezzo_corrente != null ? `€ ${a.prezzo_corrente.toFixed(2)}` : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface UnisciProps {
  fornitoreDaId: string
  nomeDa: string
  fornitori: Array<{ id: string; nome: string }>
  onClose: () => void
  onDone: () => void
}

// Unione di due fornitori duplicati: non reversibile, richiede conferma
// esplicita — stesso schema di Dialog+azione distruttiva già usato per
// eliminare una bozza/spesa altrove nell'app, senza un secondo passo di
// digitazione (non è una convenzione presente nel resto dell'app).
function UnisciFornitoreDialog({ fornitoreDaId, nomeDa, fornitori, onClose, onDone }: UnisciProps) {
  const [aId, setAId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nomeA = fornitori.find(f => f.id === aId)?.nome

  async function conferma() {
    if (!aId) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('unisci_fornitori', {
      p_fornitore_da_assorbire: fornitoreDaId,
      p_fornitore_da_mantenere: aId,
    })
    setSaving(false)
    if (err) { setError(friendlySaveError(err)); return }
    onDone()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="cassa acquisti cassa-perforated-top">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">Unisci fornitore duplicato</DialogTitle>
          <DialogDescription>
            Tutte le fatture e gli articoli a catalogo di &laquo;{nomeDa}&raquo; passeranno al fornitore scelto qui sotto,
            poi &laquo;{nomeDa}&raquo; verrà eliminato. L&apos;operazione non è reversibile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Unisci in</Label>
          <Select value={aId} onValueChange={setAId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleziona il fornitore da mantenere" />
            </SelectTrigger>
            <SelectContent>
              {fornitori.map(f => (
                <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Annulla</Button>
          <Button type="button" variant="destructive" onClick={conferma} disabled={saving || !aId}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Unione in corso…</> : `Unisci in «${nomeA ?? '…'}»`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
