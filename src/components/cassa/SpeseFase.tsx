'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { CategorieManagerDialog } from '@/components/cassa/CategorieManagerDialog'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import type { CassaChiusura, CassaCategoria, CassaSpesa } from '@/types'
import { eur2 } from '@/lib/utils'

interface Suggerimento {
  nome_spesa: string
  categoria_id: string | null
  categoria_nome: string | null
}

interface Props {
  chiusura: CassaChiusura
  ownerId: string
  role: 'manager' | 'cassiere'
  userId: string
  onBack: () => void
  onNext: () => void
}

// Fase 2 del wizard Chiusura Cassa: registrazione spese giornaliere con
// autocomplete sulle voci storiche e controllo duplicati semantici via AI
// prima di salvare una voce mai vista.
export function SpeseFase({ chiusura, ownerId, role, userId, onBack, onNext }: Props) {
  // Sia manager che cassiere possono aggiungere/eliminare spese anche su
  // una chiusura già confermata (RLS cassa_spese_manager_all e
  // cassa_spese_cassiere_* — a differenza dei campi di quadratura, le
  // spese non passano da un'approvazione, vedi QuadraturaFase).

  const [categorie, setCategorie] = useState<CassaCategoria[]>([])
  const [spese, setSpese] = useState<CassaSpesa[]>([])
  const [loadingSpese, setLoadingSpese] = useState(true)

  const [nome, setNome] = useState('')
  const [categoriaId, setCategoriaId] = useState<string>('')
  const [importo, setImporto] = useState(0)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [suggestions, setSuggestions] = useState<Suggerimento[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [checking, setChecking] = useState(false)
  const [confirmMatch, setConfirmMatch] = useState<{ nome: string; categoriaId: string | null } | null>(null)

  const [spesaDaEliminare, setSpesaDaEliminare] = useState<CassaSpesa | null>(null)
  const [eliminandoSpesa, setEliminandoSpesa] = useState(false)
  const [deleteSpesaError, setDeleteSpesaError] = useState<string | null>(null)

  async function loadCategorie() {
    const supabase = createClient()
    const { data } = await supabase.from('cassa_categorie').select('*').eq('owner_id', ownerId).order('nome')
    setCategorie((data ?? []) as CassaCategoria[])
  }

  async function loadSpese() {
    setLoadingSpese(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('cassa_spese')
      .select('*')
      .eq('chiusura_id', chiusura.id)
      .order('created_at')
    setSpese((data ?? []) as CassaSpesa[])
    setLoadingSpese(false)
  }

  useEffect(() => { loadCategorie() }, [ownerId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadSpese() }, [chiusura.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Autocomplete: interroga cassa_spese_nomi (pre-filtrata via pg_trgm) mentre l'utente digita.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const testo = nome.trim()
    if (testo.length < 2) { setSuggestions([]); return }

    debounceRef.current = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase.rpc('cassa_spese_nomi', {
        p_restaurant_id: chiusura.restaurant_id, p_query: testo, p_limit: 6,
      })
      setSuggestions((data ?? []) as Suggerimento[])
    }, 300)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [nome, chiusura.restaurant_id])

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

  async function insertSpesa(nomeSpesa: string, catId: string | null) {
    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('cassa_spese')
      .insert({
        chiusura_id: chiusura.id,
        nome_spesa: nomeSpesa,
        categoria_id: catId || null,
        importo,
        created_by: userId,
      })
      .select()
      .single()
    setSaving(false)

    if (error || !data) {
      setFormError(friendlySaveError(error))
      return
    }
    setSpese(prev => [...prev, data as CassaSpesa])
    resetForm()
  }

  async function handleAddSpesa() {
    const trimmed = nome.trim()
    if (!trimmed || importo <= 0) {
      setFormError('Inserisci un nome e un importo maggiore di zero.')
      return
    }
    setFormError(null)

    // Se il testo combacia esattamente con una voce storica non c'è nulla
    // da chiedere: si salva direttamente (è la stessa voce, non un possibile duplicato).
    const exact = suggestions.find(s => s.nome_spesa.toLowerCase() === trimmed.toLowerCase())
    if (exact) {
      await insertSpesa(exact.nome_spesa, categoriaId || exact.categoria_id)
      return
    }

    setChecking(true)
    try {
      const res = await fetch('/api/cassa/spesa-duplicati', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: chiusura.restaurant_id, testo: trimmed }),
      })
      const result = await res.json()
      if (result?.match) {
        setConfirmMatch({ nome: result.match, categoriaId: result.categoria_id ?? null })
        setChecking(false)
        return
      }
    } catch {
      // Se il controllo AI fallisce non si blocca il salvataggio.
    }
    setChecking(false)
    await insertSpesa(trimmed, categoriaId || null)
  }

  async function confermaEliminaSpesa() {
    if (!spesaDaEliminare) return
    const id = spesaDaEliminare.id
    setEliminandoSpesa(true)
    setDeleteSpesaError(null)
    const supabase = createClient()
    const { error } = await supabase.from('cassa_spese').delete().eq('id', id)
    setEliminandoSpesa(false)
    if (error) { setDeleteSpesaError(friendlySaveError(error)); return }
    setSpese(prev => prev.filter(s => s.id !== id))
    setSpesaDaEliminare(null)
  }

  const eur = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle>Spese pagate in contanti</CardTitle>
        {role === 'manager' && <CategorieManagerDialog ownerId={ownerId} onChange={loadCategorie} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Elenco con totale a sinistra, nuova spesa a destra (tablet);
            su telefono uno sotto l'altro. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-[12px] border border-border">
            {loadingSpese && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between border-b border-border px-3.5 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
            {!loadingSpese && spese.length === 0 && (
              <p className="border-b border-border px-3.5 py-6 text-center text-sm text-muted-foreground">Nessuna spesa per questa giornata.</p>
            )}
            {spese.map(s => {
              const cat = categorie.find(c => c.id === s.categoria_id)
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => setSpesaDaEliminare(s)}
                  className="flex w-full items-start justify-between gap-3 border-b border-border px-3.5 py-2.5 text-left active:scale-[0.99]"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="break-words text-sm font-medium">{s.nome_spesa}</span>
                    {cat && <span className="self-start rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.04em] text-muted-foreground">{cat.nome}</span>}
                  </span>
                  <span className="whitespace-nowrap font-mono text-sm">{eur(s.importo)}</span>
                </button>
              )
            })}
            <div className="flex items-center justify-between bg-background px-3.5 py-3">
              <span className="text-sm font-semibold">Totale spese</span>
              <span className="font-mono text-base font-semibold">€ {eur(chiusura.totale_spese_giornaliere)}</span>
            </div>
          </div>

          <div className="space-y-3 rounded-[12px] border border-border p-3.5">
            <span className="text-sm font-semibold">Nuova spesa</span>
            <div className="relative space-y-1.5">
              <Label>Descrizione</Label>
              <Input
                value={nome}
                onChange={e => { setNome(e.target.value); setShowSuggestions(true) }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Es. Ghiaccio"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="anim-swapin absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[10px] border border-border bg-popover p-1 shadow-float">
                  {suggestions.map(s => (
                    <button
                      type="button"
                      key={s.nome_spesa}
                      onMouseDown={() => pickSuggestion(s)}
                      className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left text-sm hover:bg-[oklch(0.94_0.04_180)] dark:hover:bg-[oklch(0.3_0.05_180)]"
                    >
                      <span>{s.nome_spesa}</span>
                      {s.categoria_nome && <span className="text-[10px] font-semibold uppercase tracking-[.04em] text-muted-foreground">{s.categoria_nome}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={categoriaId} onValueChange={setCategoriaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Scegli" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorie.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Importo</Label>
                <CurrencyInput value={importo} onChange={setImporto} className="cassa-numeric" />
              </div>
            </div>
            {formError && <p className="text-sm text-neg">{formError}</p>}
            <Button type="button" className="w-full" onClick={handleAddSpesa} disabled={saving || checking}>
              {checking ? 'Verifica…' : saving ? 'Salvataggio…' : 'Aggiungi spesa'}
            </Button>
          </div>
        </div>

        <div className="flex justify-between gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onBack}>Indietro</Button>
          <Button type="button" className="flex-1 sm:flex-none" onClick={onNext}>Avanti: quadratura</Button>
        </div>
      </CardContent>

      <Dialog open={!!confirmMatch} onOpenChange={o => { if (!o) setConfirmMatch(null) }}>
        <DialogContent className="cassa">
          <DialogHeader>
            <DialogTitle>Voce simile trovata</DialogTitle>
            <DialogDescription>
              Intendevi &laquo;{confirmMatch?.nome}&raquo;? Sembra la stessa voce di spesa già usata in passato.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmMatch(null)}>
              Annulla
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const trimmed = nome.trim()
                setConfirmMatch(null)
                await insertSpesa(trimmed, categoriaId || null)
              }}
            >
              Continua comunque
            </Button>
            <Button
              type="button"
              onClick={async () => {
                const match = confirmMatch
                setConfirmMatch(null)
                if (match) await insertSpesa(match.nome, categoriaId || match.categoriaId)
              }}
            >
              Usa &laquo;{confirmMatch?.nome}&raquo;
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!spesaDaEliminare} onOpenChange={o => { if (!o) { setSpesaDaEliminare(null); setDeleteSpesaError(null) } }}>
        <DialogContent className="cassa">
          <DialogHeader>
            <DialogTitle>Eliminare questa spesa?</DialogTitle>
          </DialogHeader>
          {spesaDaEliminare && (
            <p className="text-sm text-muted-foreground">
              {spesaDaEliminare.nome_spesa} · € {eur2(spesaDaEliminare.importo)}
              {' '}— l&apos;operazione non è reversibile.
            </p>
          )}
          {deleteSpesaError && <p className="text-sm text-destructive">Errore nell&apos;eliminazione: {deleteSpesaError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setSpesaDaEliminare(null); setDeleteSpesaError(null) }} disabled={eliminandoSpesa}>
              Annulla
            </Button>
            <Button type="button" variant="destructive" onClick={confermaEliminaSpesa} disabled={eliminandoSpesa}>
              {eliminandoSpesa ? 'Eliminazione…' : 'Elimina'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
