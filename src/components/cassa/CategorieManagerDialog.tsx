'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Pencil, Trash2, Plus, Tags } from 'lucide-react'
import type { CassaCategoria } from '@/types'

interface Props {
  ownerId: string
  onChange?: () => void // notifica il chiamante dopo una modifica (per ricaricare la lista categorie)
}

// Gestione categorie di spesa — riservata al manager (RLS blocca comunque
// scritture da parte del cassiere; qui limitiamo anche la visibilità).
export function CategorieManagerDialog({ ownerId, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [categorie, setCategorie] = useState<CassaCategoria[]>([])
  const [loading, setLoading] = useState(false)
  const [nome, setNome] = useState('')
  const [editing, setEditing] = useState<CassaCategoria | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('cassa_categorie')
      .select('*')
      .eq('owner_id', ownerId)
      .order('nome')
    setCategorie((data ?? []) as CassaCategoria[])
    setLoading(false)
  }

  useEffect(() => { if (open) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(c: CassaCategoria) {
    setEditing(c)
    setNome(c.nome)
    setError(null)
  }

  function resetForm() {
    setEditing(null)
    setNome('')
    setError(null)
  }

  async function handleSave() {
    const trimmed = nome.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const { error: err } = editing
      ? await supabase.from('cassa_categorie').update({ nome: trimmed }).eq('id', editing.id)
      : await supabase.from('cassa_categorie').insert({ owner_id: ownerId, nome: trimmed })

    setSaving(false)

    if (err) {
      setError(err.message.includes('duplicate') ? 'Categoria già esistente.' : err.message)
      return
    }

    resetForm()
    await load()
    onChange?.()
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questa categoria? Le spese già registrate la manterranno come riferimento storico.')) return
    const supabase = createClient()
    await supabase.from('cassa_categorie').delete().eq('id', id)
    await load()
    onChange?.()
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Tags className="w-4 h-4" /> Gestisci categorie
      </Button>

      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) resetForm() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Categorie di spesa</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Nome categoria"
                value={nome}
                onChange={e => setNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              />
              <Button type="button" onClick={handleSave} disabled={saving || !nome.trim()}>
                {editing ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              </Button>
              {editing && (
                <Button type="button" variant="ghost" onClick={resetForm}>Annulla</Button>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="max-h-64 overflow-y-auto divide-y divide-border rounded-md border border-border">
              {loading && <p className="text-sm text-muted-foreground p-3">Caricamento…</p>}
              {!loading && categorie.length === 0 && (
                <p className="text-sm text-muted-foreground p-3">Nessuna categoria. Aggiungine una.</p>
              )}
              {categorie.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm">{c.nome}</span>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(c)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
