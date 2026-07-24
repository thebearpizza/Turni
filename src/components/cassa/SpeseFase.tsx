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
import { CategorieManagerDialog } from '@/components/cassa/CategorieManagerDialog'
import { Trash2 } from 'lucide-react'
import type { CassaChiusura, CassaCategoria, CassaSpesa } from '@/types'

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
  const locked = chiusura.stato === 'confermata'

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
      setFormError(`Errore nel salvataggio: ${error?.message ?? 'sconosciuto'}`)
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

  async function handleDeleteSpesa(id: string) {
    const supabase = createClient()
    await supabase.from('cassa_spese').delete().eq('id', id)
    setSpese(prev => prev.filter(s => s.id !== id))
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Spese e categorie</CardTitle>
        {role === 'manager' && <CategorieManagerDialog ownerId={ownerId} onChange={loadCategorie} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {locked && (
          <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
            Questa chiusura è già stata confermata. La modifica sarà disponibile a breve.
          </p>
        )}

        {!locked && (
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
                <CurrencyInput value={importo} onChange={setImporto} />
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
              <Button type="button" onClick={handleAddSpesa} disabled={saving || checking}>
                {checking ? 'Verifica…' : saving ? 'Salvataggio…' : 'Aggiungi spesa'}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {loadingSpese && <p className="text-sm text-muted-foreground">Caricamento…</p>}
          {!loadingSpese && spese.length === 0 && (
            <p className="text-sm text-muted-foreground">Nessuna spesa registrata per questa giornata.</p>
          )}
          {spese.map(s => {
            const cat = categorie.find(c => c.id === s.categoria_id)
            return (
              <div key={s.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{s.nome_spesa}</span>
                  {cat && <span className="text-muted-foreground ml-2">({cat.nome})</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">€ {s.importo.toFixed(2)}</span>
                  {!locked && (
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteSpesa(s.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-1.5">
          <Label>Totale Spese Giornaliere</Label>
          <CurrencyInput value={chiusura.totale_spese_giornaliere} readOnly />
        </div>

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>Indietro</Button>
          <Button type="button" onClick={onNext}>Avanti</Button>
        </div>
      </CardContent>

      <Dialog open={!!confirmMatch} onOpenChange={o => { if (!o) setConfirmMatch(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voce simile trovata</DialogTitle>
            <DialogDescription>
              Intendevi &laquo;{confirmMatch?.nome}&raquo;? Sembra la stessa voce di spesa già usata in passato.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
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
    </Card>
  )
}
