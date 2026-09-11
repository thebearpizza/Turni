'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import { ChevronDown, ChevronUp, Trash2, Pencil, Check, Loader2, X } from 'lucide-react'
import type { CassaCategoria, CassaSpesaBozza, CassaChiusura } from '@/types'

interface Suggerimento {
  nome_spesa: string
  categoria_id: string | null
  categoria_nome: string | null
}

interface Props {
  restaurantId: string
  giorno: string
  ownerId: string | null
  userId: string
  // null finché la chiusura di questo giorno non esiste ancora —
  // confermare la prima spesa in bozza la crea (vedi assicuraChiusura).
  chiusuraId: string | null
  onChiusuraCreata: (row: CassaChiusura) => void
}

// Card "Spese da inserire" — spese annotate durante il servizio, prima
// che esista una chiusura per la giornata: sopra la card Entrate della
// Fase 1 (stessa larghezza, stesso contenitore). Confermarle le sposta
// in cassa_spese (creando la chiusura del giorno se non esiste ancora),
// esattamente come se fossero state inserite in Fase 2 — vedi
// assicuraChiusura/confermaBozza più sotto.
export function SpeseBozzaCard({ restaurantId, giorno, ownerId, userId, chiusuraId, onChiusuraCreata }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [categorie, setCategorie] = useState<CassaCategoria[]>([])
  const [bozze, setBozze] = useState<CassaSpesaBozza[]>([])
  const [loadingBozze, setLoadingBozze] = useState(true)

  const [nome, setNome] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [importo, setImporto] = useState(0)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [suggestions, setSuggestions] = useState<Suggerimento[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editCategoriaId, setEditCategoriaId] = useState('')
  const [editImporto, setEditImporto] = useState(0)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [bozzaDaEliminare, setBozzaDaEliminare] = useState<CassaSpesaBozza | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [confermandoId, setConfermandoId] = useState<string | null>(null)
  const [confermandoTutte, setConfermandoTutte] = useState(false)
  const [confermaError, setConfermaError] = useState<string | null>(null)

  useEffect(() => {
    if (!ownerId) { setCategorie([]); return }
    const supabase = createClient()
    supabase.from('cassa_categorie').select('*').eq('owner_id', ownerId).order('nome')
      .then(({ data }) => setCategorie((data ?? []) as CassaCategoria[]))
  }, [ownerId])

  useEffect(() => {
    let attivo = true
    setLoadingBozze(true)
    const supabase = createClient()
    supabase
      .from('cassa_spese_bozza')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('data', giorno)
      .order('created_at')
      .then(({ data }) => {
        if (!attivo) return
        setBozze((data ?? []) as CassaSpesaBozza[])
        setLoadingBozze(false)
      })
    return () => { attivo = false }
  }, [restaurantId, giorno])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const testo = nome.trim()
    if (testo.length < 2) { setSuggestions([]); return }
    debounceRef.current = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase.rpc('cassa_spese_nomi', { p_restaurant_id: restaurantId, p_query: testo, p_limit: 6 })
      setSuggestions((data ?? []) as Suggerimento[])
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [nome, restaurantId])

  function pickSuggestion(s: Suggerimento) {
    setNome(s.nome_spesa)
    if (s.categoria_id) setCategoriaId(s.categoria_id)
    setShowSuggestions(false)
  }

  function resetForm() {
    setNome('')
    setCategoriaId('')
    setImporto(0)
    setFormError(null)
  }

  async function handleAggiungi() {
    const trimmed = nome.trim()
    if (!trimmed || importo <= 0) {
      setFormError('Inserisci un nome e un importo maggiore di zero.')
      return
    }
    setFormError(null)
    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('cassa_spese_bozza')
      .insert({ restaurant_id: restaurantId, data: giorno, nome_spesa: trimmed, categoria_id: categoriaId || null, importo, created_by: userId })
      .select()
      .single()
    setSaving(false)
    if (error || !data) {
      setFormError(friendlySaveError(error))
      return
    }
    setBozze(prev => [...prev, data as CassaSpesaBozza])
    resetForm()
  }

  function iniziaModifica(b: CassaSpesaBozza) {
    setEditingId(b.id)
    setEditNome(b.nome_spesa)
    setEditCategoriaId(b.categoria_id ?? '')
    setEditImporto(b.importo)
    setEditError(null)
  }

  async function salvaModifica() {
    if (!editingId) return
    const trimmed = editNome.trim()
    if (!trimmed || editImporto <= 0) {
      setEditError('Inserisci un nome e un importo maggiore di zero.')
      return
    }
    setEditSaving(true)
    setEditError(null)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('cassa_spese_bozza')
      .update({ nome_spesa: trimmed, categoria_id: editCategoriaId || null, importo: editImporto })
      .eq('id', editingId)
      .select()
      .single()
    setEditSaving(false)
    if (error || !data) {
      setEditError(friendlySaveError(error))
      return
    }
    setBozze(prev => prev.map(b => (b.id === editingId ? (data as CassaSpesaBozza) : b)))
    setEditingId(null)
  }

  async function confermaEliminaBozza() {
    if (!bozzaDaEliminare) return
    const id = bozzaDaEliminare.id
    setEliminando(true)
    setDeleteError(null)
    const supabase = createClient()
    const { error } = await supabase.from('cassa_spese_bozza').delete().eq('id', id)
    setEliminando(false)
    if (error) { setDeleteError(friendlySaveError(error)); return }
    setBozze(prev => prev.filter(b => b.id !== id))
    setBozzaDaEliminare(null)
  }

  // Trova la chiusura del giorno, creandola (come bozza "in_verifica",
  // stessa forma dell'upsert di Fase 1) se non esiste ancora — una
  // spesa in bozza può nascere prima che chiunque abbia aperto/salvato
  // la Fase 1 di quel giorno. Ritorna l'id da usare per cassa_spese.
  async function assicuraChiusura(): Promise<string | null> {
    if (chiusuraId) return chiusuraId
    const supabase = createClient()
    const { data, error } = await supabase
      .from('cassa_chiusure')
      .insert({ restaurant_id: restaurantId, data: giorno, stato: 'in_verifica' as const, created_by: userId })
      .select()
      .single()
    if (!error && data) {
      onChiusuraCreata(data as CassaChiusura)
      return (data as CassaChiusura).id
    }
    // Un'altra sessione l'ha creata nel frattempo (stesso restaurant_id+data,
    // vincolo unique) — non è un errore, si riusa quella.
    if (error?.code === '23505') {
      const { data: esistente } = await supabase.from('cassa_chiusure').select('*').eq('restaurant_id', restaurantId).eq('data', giorno).single()
      if (esistente) {
        onChiusuraCreata(esistente as CassaChiusura)
        return (esistente as CassaChiusura).id
      }
    }
    setConfermaError(friendlySaveError(error))
    return null
  }

  async function confermaBozza(b: CassaSpesaBozza) {
    setConfermandoId(b.id)
    setConfermaError(null)
    const idChiusura = await assicuraChiusura()
    if (!idChiusura) { setConfermandoId(null); return }

    const supabase = createClient()
    const { error } = await supabase
      .from('cassa_spese')
      .insert({ chiusura_id: idChiusura, nome_spesa: b.nome_spesa, categoria_id: b.categoria_id, importo: b.importo, created_by: userId })
    if (error) {
      setConfermaError(`«${b.nome_spesa}»: ${friendlySaveError(error)}`)
      setConfermandoId(null)
      return
    }
    await supabase.from('cassa_spese_bozza').delete().eq('id', b.id)
    setBozze(prev => prev.filter(x => x.id !== b.id))
    setConfermandoId(null)
  }

  async function confermaTutte() {
    if (bozze.length === 0) return
    setConfermandoTutte(true)
    setConfermaError(null)
    const idChiusura = await assicuraChiusura()
    if (!idChiusura) { setConfermandoTutte(false); return }

    const supabase = createClient()
    const confermate: string[] = []
    for (const b of bozze) {
      const { error } = await supabase
        .from('cassa_spese')
        .insert({ chiusura_id: idChiusura, nome_spesa: b.nome_spesa, categoria_id: b.categoria_id, importo: b.importo, created_by: userId })
      if (error) {
        setConfermaError(`Fermato a «${b.nome_spesa}»: ${friendlySaveError(error)}`)
        break
      }
      await supabase.from('cassa_spese_bozza').delete().eq('id', b.id)
      confermate.push(b.id)
    }
    setBozze(prev => prev.filter(x => !confermate.includes(x.id)))
    setConfermandoTutte(false)
  }

  const totale = bozze.reduce((s, b) => s + b.importo, 0)
  const busy = confermandoId !== null || confermandoTutte

  return (
    <Card className="cassa-perforated-top mb-4">
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <CardTitle className="cassa-display text-lg">Spese da inserire</CardTitle>
          {!loadingBozze && bozze.length > 0 && (
            <Badge variant="secondary">{bozze.length} · € {totale.toFixed(2)}</Badge>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={e => { e.stopPropagation(); setExpanded(x => !x) }}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <div className="space-y-3 border border-border rounded-lg p-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
              <div className="relative space-y-1.5">
                <Label>Voce di spesa</Label>
                <Input
                  value={nome}
                  onChange={e => { setNome(e.target.value); setShowSuggestions(true) }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Es. Trasporto merci"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-48 overflow-y-auto">
                    {suggestions.map(s => (
                      <button
                        type="button"
                        key={s.nome_spesa}
                        onMouseDown={() => pickSuggestion(s)}
                        className="flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-accent"
                      >
                        <span>{s.nome_spesa}</span>
                        {s.categoria_nome && <span className="text-xs text-muted-foreground">{s.categoria_nome}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5 sm:w-48">
                <Label>Importo</Label>
                <CurrencyInput value={importo} onChange={setImporto} className="cassa-numeric" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={categoriaId} onValueChange={setCategoriaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona una categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categorie.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <div className="flex justify-end">
              <Button type="button" onClick={handleAggiungi} disabled={saving}>
                {saving ? 'Salvataggio…' : 'Aggiungi alla bozza'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {loadingBozze && Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
            {!loadingBozze && bozze.length === 0 && (
              <p className="text-sm text-muted-foreground">Nessuna spesa in bozza per questa giornata.</p>
            )}
            {bozze.map(b => {
              if (editingId === b.id) {
                return (
                  <div key={b.id} className="space-y-3 rounded-md border border-border p-3 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                      <div className="space-y-1.5">
                        <Label>Voce di spesa</Label>
                        <Input value={editNome} onChange={e => setEditNome(e.target.value)} />
                      </div>
                      <div className="space-y-1.5 sm:w-48">
                        <Label>Importo</Label>
                        <CurrencyInput value={editImporto} onChange={setEditImporto} className="cassa-numeric" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Categoria</Label>
                      <Select value={editCategoriaId} onValueChange={setEditCategoriaId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona una categoria" />
                        </SelectTrigger>
                        <SelectContent>
                          {categorie.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {editError && <p className="text-sm text-destructive">{editError}</p>}
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)} disabled={editSaving}>
                        <X className="h-4 w-4" /> Annulla
                      </Button>
                      <Button type="button" size="sm" onClick={salvaModifica} disabled={editSaving}>
                        {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva
                      </Button>
                    </div>
                  </div>
                )
              }
              const cat = categorie.find(c => c.id === b.categoria_id)
              return (
                <div key={b.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1 break-words">
                    <span className="font-medium">{b.nome_spesa}</span>
                    {cat && <span className="text-muted-foreground ml-2">({cat.nome})</span>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="cassa-numeric whitespace-nowrap mr-1">€ {b.importo.toFixed(2)}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Modifica" onClick={() => iniziaModifica(b)} disabled={busy}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Elimina" onClick={() => setBozzaDaEliminare(b)} disabled={busy}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" title="Conferma e inserisci in chiusura" onClick={() => confermaBozza(b)} disabled={busy}>
                      {confermandoId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          {confermaError && <p className="text-sm text-destructive">{confermaError}</p>}

          {bozze.length > 1 && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={confermaTutte} disabled={busy}>
                {confermandoTutte ? <><Loader2 className="h-4 w-4 animate-spin" /> Conferma in corso…</> : 'Conferma tutte in chiusura'}
              </Button>
            </div>
          )}
        </CardContent>
      )}

      <Dialog open={!!bozzaDaEliminare} onOpenChange={o => { if (!o) { setBozzaDaEliminare(null); setDeleteError(null) } }}>
        <DialogContent className="cassa cassa-perforated-top">
          <DialogHeader>
            <DialogTitle className="cassa-display text-lg">Eliminare questa spesa in bozza?</DialogTitle>
            {bozzaDaEliminare && (
              <DialogDescription>
                {bozzaDaEliminare.nome_spesa} · € {bozzaDaEliminare.importo.toFixed(2)} — l&apos;operazione non è reversibile.
              </DialogDescription>
            )}
          </DialogHeader>
          {deleteError && <p className="text-sm text-destructive">Errore nell&apos;eliminazione: {deleteError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setBozzaDaEliminare(null); setDeleteError(null) }} disabled={eliminando}>
              Annulla
            </Button>
            <Button type="button" variant="destructive" onClick={confermaEliminaBozza} disabled={eliminando}>
              {eliminando ? 'Eliminazione…' : 'Elimina'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
