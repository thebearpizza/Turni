'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import { FormSpesa } from '@/components/cassa/FormSpesa'
import { contaModifiche, leggiModifica, scriviModifica, type ModificaLetta, type SpesaNuova } from '@/app/api/cassa/modificaPayload'
import { RigaTastierino, Pillola, Foglio, IconaMatita, IconaPiu, IconaSpunta, useApriChiudi, n2, eur, dataLunga } from '@/components/cassa/comuni'
import { cn } from '@/lib/utils'
import type { CassaCategoria, CassaChiusura, CassaSpesa } from '@/types'
import type { ModificaField } from '@/lib/cassa/modificaFields'

// Dettaglio di una chiusura già inviata (Chiusura Tablet v2 · 5e): si apre
// dopo "Conferma chiusura" e da Lista chiusure. Ogni voce si tocca e si
// corregge col tastierino; le correzioni e le nuove spese del cassiere
// vanno in revisione al manager ("Invia N modifiche al manager"), quelle
// del manager si salvano subito.

const TZ = 'Europe/Rome'
type Campo = Extract<ModificaField, 'entrate_contanti' | 'entrate_pos' | 'entrate_bonifico' | 'incasso_asporto' | 'coperti' | 'fondo_cassa_finale' | 'contanti_per_banca'>
interface Nuova extends SpesaNuova { tmp: string }

export function DettaglioChiusura({ chiusura, spese, categorie, role, userId, tel, appenaInviata, nomeLocale, onNuova, onAggiornata }: {
  chiusura: CassaChiusura; spese: CassaSpesa[]; categorie: CassaCategoria[]; role: 'manager' | 'cassiere'; userId: string; tel: boolean
  appenaInviata: boolean; nomeLocale: string; onNuova: () => void; onAggiornata: () => void
}) {
  const [mod, setMod] = useState<Partial<Record<Campo, number>>>({})
  const [speseMod, setSpeseMod] = useState<Record<string, number>>({})
  const [gone, setGone] = useState<string[]>([])
  const [nuove, setNuove] = useState<Nuova[]>([])
  const [pendente, setPendente] = useState<{ id: string; letta: ModificaLetta | null } | null>(null)
  const [inviatoDa, setInviatoDa] = useState<string | null>(null)
  const [invio, setInvio] = useState(false)
  const [motivo, setMotivo] = useState('')
  const foglioSpesa = useApriChiudi()
  const foglioInvio = useApriChiudi()

  const caricaPendente = useCallback(async () => {
    // Il cassiere potrebbe non avere accesso alle richieste (RLS): in quel
    // caso il dettaglio resta modificabile e il server rifiuta i doppioni.
    const { data } = await createClient().from('cassa_chiusure_modifiche').select('id, payload').eq('chiusura_id', chiusura.id).eq('stato', 'in_attesa').order('created_at', { ascending: false }).limit(1).maybeSingle()
    setPendente(data ? { id: data.id, letta: leggiModifica(data.payload) } : null)
  }, [chiusura.id])
  useEffect(() => { caricaPendente() }, [caricaPendente])

  useEffect(() => {
    const chi = chiusura.updated_by ?? chiusura.created_by
    if (!chi) return
    createClient().from('profiles').select('full_name').eq('id', chi).maybeSingle().then(({ data }) => {
      if (data?.full_name) { const [n, c] = data.full_name.split(' '); setInviatoDa(c ? `${n} ${c[0]}.` : n) }
    })
  }, [chiusura.updated_by, chiusura.created_by])

  const bloccata = !!pendente
  const val = (k: Campo) => (mod[k] ?? Number(chiusura[k]))
  const speseVis = spese.filter(s => !gone.includes(s.id))
  const totSpese = speseVis.reduce((t, s) => t + (speseMod[s.id] ?? Number(s.importo)), 0) + nuove.reduce((t, s) => t + s.importo, 0)
  const tot = val('entrate_contanti') + val('entrate_pos') + val('entrate_bonifico')
  const media = val('coperti') ? Math.max(0, tot - val('incasso_asporto')) / val('coperti') : 0
  const banca = Number(chiusura.fondo_cassa_iniziale) + val('entrate_contanti') - totSpese - val('fondo_cassa_finale')
  const diff = val('contanti_per_banca') - banca
  const quadra = Math.abs(diff) < 0.005

  const campiCambiati = (Object.keys(mod) as Campo[]).filter(k => Math.abs((mod[k] ?? 0) - Number(chiusura[k])) > 0.004)
  const speseCambiate = Object.keys(speseMod).filter(id => !gone.includes(id) && Math.abs(speseMod[id] - Number(spese.find(s => s.id === id)?.importo ?? 0)) > 0.004)
  const letta: ModificaLetta = {
    campi: Object.fromEntries(campiCambiati.map(k => [k, mod[k]!])),
    spese: { modifica: speseCambiate.map(id => ({ id, importo: speseMod[id] })), elimina: gone, aggiungi: nuove.map(({ tmp, ...n }) => { void tmp; return n }) },
    motivo: motivo.trim() || null,
  }
  const n = contaModifiche(letta)
  const etichettaInvio = role === 'manager'
    ? `Salva ${n} ${n === 1 ? 'modifica' : 'modifiche'}`
    : `Invia ${n} ${n === 1 ? 'modifica' : 'modifiche'} al manager`

  function azzera() { setMod({}); setSpeseMod({}); setGone([]); setNuove([]); setMotivo('') }

  async function inviaAlManager() {
    setInvio(true)
    try {
      const res = await fetch('/api/cassa/richiedi-modifica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chiusura_id: chiusura.id, payload: scriviModifica(letta) }) })
      const r = await res.json().catch(() => null)
      if (!res.ok) throw new Error(r?.error ?? 'Invio non riuscito')
      foglioInvio.chiudi()
      azzera()
      toast({ title: n === 1 ? 'Modifica inviata al manager' : `${n} modifiche inviate al manager` })
      caricaPendente()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Invio non riuscito', variant: 'destructive' })
    } finally { setInvio(false) }
  }

  async function salvaDirettamente() {
    setInvio(true)
    const sb = createClient()
    try {
      if (campiCambiati.length) {
        const { error } = await sb.from('cassa_chiusure').update({ ...letta.campi, updated_by: userId }).eq('id', chiusura.id)
        if (error) throw error
      }
      for (const m of letta.spese.modifica) { const { error } = await sb.from('cassa_spese').update({ importo: m.importo }).eq('id', m.id); if (error) throw error }
      if (gone.length) { const { error } = await sb.from('cassa_spese').delete().in('id', gone); if (error) throw error }
      if (nuove.length) { const { error } = await sb.from('cassa_spese').insert(letta.spese.aggiungi.map(a => ({ ...a, chiusura_id: chiusura.id, created_by: userId }))); if (error) throw error }
      azzera()
      toast({ title: n === 1 ? 'Modifica salvata' : `${n} modifiche salvate` })
      onAggiornata()
    } catch (e) {
      toast({ title: friendlySaveError(e as { message?: string; code?: string }), variant: 'destructive' })
    } finally { setInvio(false) }
  }

  // Riga del dettaglio: tocco → tastierino; "Modificato" se cambiata.
  const riga = (l: React.ReactNode, v: number, onCambia: ((x: number) => void) | null, opt: { mod?: boolean; int?: boolean; rm?: () => void; badge?: string } = {}) => (
    <RigaTastierino valore={v} onCambia={onCambia ?? (() => {})} bloccata={!onCambia || bloccata} decimali={opt.int ? 0 : 2} onRimuovi={opt.rm} etichettaRimuovi="Elimina spesa"
      className="-mx-[22px] flex h-12 items-center justify-between border-t border-border px-[22px]">
      {({ aperto, testo }) => (<>
        <span className="flex min-w-0 items-center gap-2 text-[15px]"><span className="truncate">{l}</span>{(opt.mod || opt.badge) && <Pillola tono="warn">{opt.badge ?? 'Modificato'}</Pillola>}</span>
        <span className={cn('flex-none font-mono text-[17px] font-medium', aperto ? (testo ? 'text-[oklch(0.45_0.1_180)]' : 'text-muted-foreground') : '')}>{testo ?? (opt.int ? String(v) : n2(v))}</span>
      </>)}
    </RigaTastierino>
  )
  const campo = (l: string, k: Campo, int?: boolean) => riga(l, val(k), x => setMod(m => ({ ...m, [k]: x })), { mod: campiCambiati.includes(k), int })
  const totale = (l: string, v: string) => (
    <div className="flex h-12 items-center justify-between border-t border-border"><span className="text-[15px] font-semibold">{l}</span><span className="font-mono text-[17px] font-semibold">{v}</span></div>
  )
  const card = (titolo: string, children: React.ReactNode) => (
    <div className="flex flex-col self-start rounded-[10px] border border-border bg-card px-[22px] pb-1 pt-[18px]">
      <span className="mb-2.5 text-[17px] font-semibold">{titolo}</span>
      {children}
    </div>
  )
  const nomeCat = (id: string | null) => categorie.find(c => c.id === id)?.nome

  const statoBadge = pendente ? <Pillola tono="warn" className="px-3.5 py-2 text-[13px] normal-case tracking-normal">In revisione</Pillola>
    : appenaInviata ? <Pillola tono="ok" className="px-3.5 py-2 text-[13px] normal-case tracking-normal">Inviata</Pillola>
    : <Pillola tono="ok" className="px-3.5 py-2 text-[13px] normal-case tracking-normal">Confermata</Pillola>
  const ora = formatInTimeZone(new Date(chiusura.updated_at), TZ, 'HH:mm')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <div className={cn('flex flex-none items-center gap-4', tel ? 'px-4 pb-3' : 'px-8 pt-6')}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('font-semibold tracking-[-0.4px]', tel ? 'text-lg' : 'text-[22px]')}>Chiusura di {dataLunga(chiusura.data).toLowerCase()}{role === 'manager' && nomeLocale ? ` · ${nomeLocale}` : ''}</span>
          <span className="text-sm font-medium text-muted-foreground">Inviata{inviatoDa ? ` da ${inviatoDa}` : ''} alle {ora}</span>
        </div>
        {statoBadge}
      </div>

      {pendente && (
        <div className={cn('anim-swapin rounded-[10px] bg-warn-tint px-3.5 py-3 text-sm font-medium leading-[1.45] text-warn', tel ? 'mx-4 mb-3' : 'mx-8 mt-4')}>
          C&apos;è una modifica in revisione dal manager: i valori qui sotto restano validi finché non viene approvata.
        </div>
      )}

      <div className={cn('grid gap-5', tel ? 'grid-cols-1 px-4 pb-4' : 'grid-cols-3 px-8 py-6')}>
        {card('Incassi', (<>
          {campo('Contanti', 'entrate_contanti')}
          {campo('POS', 'entrate_pos')}
          {campo('Bonifico', 'entrate_bonifico')}
          {campo('Asporto', 'incasso_asporto')}
          {campo('Coperti', 'coperti', true)}
          {totale('Totale entrate', eur(tot))}
          {totale('Media scontrino', eur(media))}
        </>))}
        {card('Spese', (<>
          {speseVis.map(s => riga(
            nomeCat(s.categoria_id) ? `${s.nome_spesa} · ${nomeCat(s.categoria_id)}` : s.nome_spesa,
            speseMod[s.id] ?? Number(s.importo),
            x => setSpeseMod(m => ({ ...m, [s.id]: x })),
            { mod: speseCambiate.includes(s.id), rm: () => setGone(g => [...g, s.id]) },
          ))}
          {nuove.map(s => riga(
            nomeCat(s.categoria_id) ? `${s.nome_spesa} · ${nomeCat(s.categoria_id)}` : s.nome_spesa,
            s.importo, x => setNuove(p => p.map(y => (y.tmp === s.tmp ? { ...y, importo: x } : y))),
            { badge: 'Nuova', rm: () => setNuove(p => p.filter(y => y.tmp !== s.tmp)) },
          ))}
          {gone.length > 0 && (
            <button type="button" onClick={() => setGone([])} className="-mx-[22px] flex h-10 items-center border-t border-border px-[22px] text-[13px] text-muted-foreground active:scale-[0.99]">
              {gone.length === 1 ? '1 spesa eliminata' : `${gone.length} spese eliminate`} · <span className="ml-1 font-semibold text-foreground underline underline-offset-2">Ripristina</span>
            </button>
          )}
          {!bloccata && (
            <button type="button" onClick={foglioSpesa.apri} className="mb-2.5 mt-1.5 flex h-12 items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong text-[15px] font-medium active:scale-[0.99]">
              <IconaPiu />Aggiungi spesa
            </button>
          )}
          {totale('Totale spese', eur(totSpese))}
        </>))}
        {card('Quadratura', (<>
          {riga('Fondo cassa iniziale', Number(chiusura.fondo_cassa_iniziale), null)}
          {campo('Fondo cassa finale', 'fondo_cassa_finale')}
          {riga('Banca teorica', banca, null)}
          {campo('Contanti per banca', 'contanti_per_banca')}
          <div className={cn('-mx-[22px] mt-2 flex h-14 items-center justify-between px-[22px]', quadra ? 'bg-[oklch(0.95_0.03_150)] text-ok dark:bg-ok-tint' : 'bg-neg-tint text-neg')}>
            <span className="text-[15px] font-semibold">{quadra ? 'Differenza · quadra' : 'Differenza'}</span>
            <span className="font-mono text-xl font-semibold">€ {diff > 0.004 ? '+' : ''}{n2(diff)}</span>
          </div>
        </>))}

        <div className={cn('flex items-center gap-2.5 text-[15px] text-muted-foreground', tel ? 'flex-wrap' : 'col-span-3')}>
          <IconaMatita />
          <span className="min-w-0 flex-1">{role === 'manager' ? 'Tocca una voce per modificarla. Le modifiche si salvano subito sulla chiusura.' : 'Tocca una voce per modificarla. Le modifiche e le nuove spese vanno in revisione al manager.'}</span>
          {n > 0 && (
            <button type="button" disabled={invio} onClick={role === 'manager' ? salvaDirettamente : foglioInvio.apri}
              className={cn('anim-swapin flex h-12 items-center justify-center rounded-[12px] bg-primary px-[22px] text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60', tel && 'w-full')}>
              {invio ? 'Salvataggio…' : etichettaInvio}
            </button>
          )}
        </div>

        {appenaInviata && (
          <div className={cn('flex flex-col items-center gap-8 pb-4 pt-[22px]', !tel && 'col-span-3 self-end')}>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ok-tint text-ok shadow-[0_0_0_10px_oklch(0.92_0.04_150/.45),0_0_0_22px_oklch(0.92_0.04_150/.2),0_0_40px_18px_oklch(0.85_0.08_150/.25)]">
              <IconaSpunta size={30} />
            </div>
            <div className="-mt-2 flex flex-col items-center gap-1 text-center">
              <span className="text-2xl font-semibold tracking-[-0.4px]">Chiusura inviata</span>
              <span className="text-[15px] text-muted-foreground">Il fondo finale passa alla prossima chiusura.</span>
            </div>
            <button type="button" onClick={onNuova} className="-mt-3 flex h-[60px] items-center gap-2.5 rounded-[12px] bg-primary px-9 text-[17px] font-semibold text-primary-foreground active:scale-[0.98]">
              <IconaPiu size={18} />Nuova chiusura
            </button>
          </div>
        )}
      </div>

      <Foglio aperto={foglioSpesa.aperto} esce={foglioSpesa.esce} onChiudi={foglioSpesa.chiudi} titolo="Aggiungi spesa" sotto={role === 'manager' ? 'Si salva con le altre modifiche' : 'Va in revisione al manager con le altre modifiche'}>
        <FormSpesa senzaCornice conFoto={false} restaurantId={chiusura.restaurant_id} categorie={categorie} cta="Aggiungi spesa" onAnnulla={foglioSpesa.chiudi}
          onSalva={async s => { setNuove(p => [...p, { tmp: crypto.randomUUID(), nome_spesa: s.nome, categoria_id: s.categoriaId, importo: s.importo }]); foglioSpesa.chiudi(); return true }} />
      </Foglio>

      <Foglio aperto={foglioInvio.aperto} esce={foglioInvio.esce} onChiudi={foglioInvio.chiudi} titolo={etichettaInvio} sotto="Il manager le vede in Approvazioni">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Perché la modifichi? <span className="font-normal text-muted-foreground">(facoltativo)</span></span>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} maxLength={500} placeholder="Es. Avevo contato male una mazzetta da 20."
              className="resize-none rounded-[12px] border border-line-strong bg-card px-4 py-3 text-base outline-none caret-[oklch(0.58_0.12_180)] focus:border-foreground" />
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <button type="button" onClick={foglioInvio.chiudi} className="flex h-14 items-center justify-center rounded-[12px] border border-line-strong text-base font-medium active:scale-[0.98]">Annulla</button>
            <button type="button" onClick={inviaAlManager} disabled={invio} className="flex h-14 items-center justify-center rounded-[12px] bg-primary text-base font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60">{invio ? 'Invio…' : 'Invia al manager'}</button>
          </div>
        </div>
      </Foglio>
    </div>
  )
}
