'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { chiediConferma } from '@/components/shared/Conferma'
import { CampoCassa, MenuScelta, IconaX } from '@/components/cassa/comuni'
import { cn } from '@/lib/utils'
import type { CassaCategoria } from '@/types'

// Modulo "Nuova spesa" / "Nuova bozza di spesa" di Chiusura Tablet v2:
// descrizione con le voci già usate sotto il campo, categoria a tendina,
// importo col tastierino, foto dello scontrino e pulsanti in fondo.

export interface SpesaInserita { nome: string; categoriaId: string | null; importo: number; foto: File | null }

interface Suggerimento { nome_spesa: string; categoria_id: string | null; categoria_nome: string | null }

export function FormSpesa({ restaurantId, categorie, titolo, destra, cta, onSalva, onAnnulla, gestisciCategorie, senzaCornice, conFoto = true }: {
  restaurantId: string
  categorie: CassaCategoria[]
  titolo?: string
  destra?: string
  cta: string
  onSalva: (s: SpesaInserita) => Promise<boolean>
  /** Con Annulla i pulsanti diventano "Annulla | Salva" (1fr 2fr). */
  onAnnulla?: () => void
  /** Accanto all'etichetta Categoria (solo manager): gestione categorie. */
  gestisciCategorie?: React.ReactNode
  senzaCornice?: boolean
  conFoto?: boolean
}) {
  const [nome, setNome] = useState('')
  const [categoriaId, setCategoriaId] = useState<string | null>(null)
  const [importo, setImporto] = useState<number | null>(null)
  const [foto, setFoto] = useState<File | null>(null)
  const [sugg, setSugg] = useState<Suggerimento[]>([])
  const [mostra, setMostra] = useState(false)
  const [evid, setEvid] = useState(0)
  const [invio, setInvio] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Voci già usate nel locale mentre si scrive (cassa_spese_nomi).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = nome.trim()
    if (q.length < 2) { timer.current = setTimeout(() => setSugg([]), 0); return }
    timer.current = setTimeout(async () => {
      const { data } = await createClient().rpc('cassa_spese_nomi', { p_restaurant_id: restaurantId, p_query: q, p_limit: 3 })
      setSugg((data ?? []) as Suggerimento[])
      setEvid(0)
    }, 250)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [nome, restaurantId])

  function scegli(s: Suggerimento) {
    setNome(s.nome_spesa)
    if (s.categoria_id) setCategoriaId(s.categoria_id)
    setMostra(false)
  }

  async function salva() {
    const testo = nome.trim()
    if (!testo || !importo || importo <= 0) { setErrore('Inserisci una descrizione e un importo maggiore di zero.'); return }
    setErrore(null)
    setInvio(true)
    let nomeFinale = testo, cat = categoriaId
    // Una voce mai usata potrebbe essere un doppione di una esistente
    // scritta diversamente: si chiede, non si sostituisce da soli.
    const esatta = sugg.find(s => s.nome_spesa.toLowerCase() === testo.toLowerCase())
    if (esatta) nomeFinale = esatta.nome_spesa
    else {
      try {
        // Anche lato browser un tetto di 6 secondi: se il controllo non
        // risponde in tempo la spesa si salva com'è.
        const res = await fetch('/api/cassa/spesa-duplicati', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurant_id: restaurantId, testo }), signal: AbortSignal.timeout(6_000) })
        const r = await res.json().catch(() => null)
        if (r?.match && await chiediConferma({ titolo: 'Voce simile trovata', testo: `Intendevi «${r.match}»? Sembra la stessa voce già usata in passato.`, conferma: `Usa «${r.match}»`, annulla: 'Tieni la mia', distruttiva: false })) {
          nomeFinale = r.match
          cat = cat ?? r.categoria_id ?? null
        }
      } catch { /* il controllo è un aiuto: se non risponde si salva com'è */ }
    }
    const ok = await onSalva({ nome: nomeFinale, categoriaId: cat, importo, foto })
    setInvio(false)
    if (ok) { setNome(''); setCategoriaId(null); setImporto(null); setFoto(null); setSugg([]) }
  }

  const aperti = mostra && sugg.length > 0
  return (
    <div className={cn('flex flex-col gap-3', !senzaCornice && 'rounded-[8px] border border-line-strong bg-card p-4')}>
      {(titolo || destra) && (
        <div className="flex items-center justify-between">
          {titolo && <span className="text-[15px] font-semibold">{titolo}</span>}
          {destra && <span className="text-[13px] font-medium text-muted-foreground">{destra}</span>}
        </div>
      )}
      <div className="relative flex flex-col gap-1.5">
        <span className="text-sm font-medium">Descrizione</span>
        <input
          value={nome}
          onChange={e => { setNome(e.target.value); setMostra(true) }}
          onFocus={() => setMostra(true)}
          onBlur={() => setTimeout(() => setMostra(false), 150)}
          onKeyDown={e => {
            if (!aperti) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setEvid(i => Math.min(sugg.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setEvid(i => Math.max(0, i - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); scegli(sugg[evid]) }
          }}
          placeholder="Es. Ghiaccio"
          className="h-12 rounded-[12px] border-[1.5px] border-line-strong bg-card px-4 text-base outline-none caret-[oklch(0.58_0.12_180)] placeholder:text-muted-foreground focus:border-foreground"
        />
        {aperti && (
          <div className="anim-swapin overflow-hidden rounded-[6px] border border-border bg-card shadow-[0_2px_8px_rgba(20,30,50,.05)]">
            {sugg.map((g, i) => (
              <button key={g.nome_spesa} type="button" onMouseDown={e => { e.preventDefault(); scegli(g) }}
                className={cn('flex min-h-11 w-full items-center justify-between border-b border-border px-4 text-left last:border-b-0', i === evid && 'bg-[oklch(0.94_0.04_180)] dark:bg-[oklch(0.3_0.05_180)]')}>
                <span className="text-[15px] font-medium">{g.nome_spesa}</span>
                {g.categoria_nome && <span className="rounded-full bg-[oklch(0.94_0.01_250)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary">{g.categoria_nome}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between text-sm font-medium">Categoria{gestisciCategorie}</span>
          <MenuScelta valore={categoriaId} opzioni={categorie.map(c => ({ k: c.id, l: c.nome }))} onScegli={setCategoriaId} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Importo</span>
          <CampoCassa valore={importo} onCambia={setImporto} taglia="l" />
        </div>
      </div>
      {conFoto && (
        <>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => { setFoto(e.target.files?.[0] ?? null); e.target.value = '' }} />
          {foto ? (
            <div className="flex h-11 items-center gap-2 rounded-[12px] border border-line-strong px-4 text-sm font-medium">
              <span className="min-w-0 flex-1 truncate">Foto scontrino allegata</span>
              <button type="button" aria-label="Togli la foto" onClick={() => setFoto(null)} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]"><IconaX size={18} /></button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex h-11 items-center justify-center rounded-[12px] border border-dashed border-line-strong text-sm font-medium text-muted-foreground active:scale-[0.99]">
              Allega foto scontrino
            </button>
          )}
        </>
      )}
      {errore && <span className="text-sm text-neg">{errore}</span>}
      {onAnnulla ? (
        <div className="mt-auto grid grid-cols-[1fr_2fr] gap-2">
          <button type="button" onClick={onAnnulla} className="flex h-12 items-center justify-center rounded-[12px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Annulla</button>
          <button type="button" onClick={salva} disabled={invio} className="flex h-12 items-center justify-center rounded-[12px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60">{invio ? 'Salvataggio…' : cta}</button>
        </div>
      ) : (
        <button type="button" onClick={salva} disabled={invio} className="flex h-12 items-center justify-center rounded-[12px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60">{invio ? 'Salvataggio…' : cta}</button>
      )}
    </div>
  )
}

/** Carica la foto dello scontrino (bucket proposto "cassa_scontrini"). */
export async function caricaFotoScontrino(restaurantId: string, foto: File | null): Promise<string | null> {
  if (!foto) return null
  try {
    const ext = foto.name.split('.').pop() || 'jpg'
    const path = `${restaurantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await createClient().storage.from('cassa_scontrini').upload(path, foto, { contentType: foto.type || 'image/jpeg', upsert: false })
    return error ? null : path
  } catch { return null }
}

/** Errore di colonna mancante (migrazione foto non ancora applicata). */
export const colonnaMancante = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /foto_path/.test(e.message ?? ''))
