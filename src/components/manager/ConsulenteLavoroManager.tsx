'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { chiediConferma } from '@/components/shared/Conferma'
import { generateUnifiedPDF } from '@/lib/generateUnifiedPDF'
import type { ConsultantMessage, Profile } from '@/types'
import {
  BarraAltro, ElencoAltro, PannelloDettaglio, GrigliaAltro, FoglioAltro, TestataFoglio, CorpoFoglio, Campo, Testo,
  GruppoPillole, Nota, PulsantiSalva, useUscita, USCITA, GRIGIO_TUTTI, CLASSE_INPUT, ICONA_RIGENERA, ICONA_X,
  generaPassword, usernameDa, type RigaAltro, type DatiDettaglio, type Scheda,
} from '@/components/altro/comuni'
import { FoglioCredenziali, type StatoCredenziali } from '@/components/altro/Credenziali'

// Consulenti del lavoro (scheda "Consulenti" di Dipendenti, solo manager).
// Il design non ha questa schermata: segue lo schema di MTAltro — elenco,
// dettaglio con accesso, locali autorizzati e la bacheca privata dei
// messaggi (con allegati unificati in un PDF), foglio Nuovo/Modifica
// consulente e foglio del messaggio.

const TZ = 'Europe/Rome'
const MAX_BYTES = 10 * 1024 * 1024
type Consulente = Pick<Profile, 'id' | 'full_name' | 'username' | 'last_active_at' | 'consultant_restaurant_ids' | 'can_view_hours'>

const data = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), TZ, 'dd/MM/yyyy HH:mm') : 'Mai')
const dataCorta = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), TZ, 'dd/MM HH:mm') : 'Mai')

interface StatoForm { id: string | null; t: string; u: string | null; pw: string; locali: string[]; ore: boolean }
interface StatoMsg { cid: string; titolo: string; corpo: string; file: File[]; risposta: ConsultantMessage | null }

export function ConsulenteLavoroManager({ managerId, restaurants, schede, disabilitato }: {
  managerId: string
  restaurants: { id: string; name: string }[]
  /** Schede della barra di Dipendenti (reparti + Consulenti). */
  schede: Scheda[]
  disabilitato?: boolean
}) {
  const [lista, setLista] = useState<Consulente[] | null>(null)
  const [thread, setThread] = useState<Record<string, ConsultantMessage[]>>({})
  const [sel, setSel] = useState<string | null>(null)
  const [esceD, setEsceD] = useState(false)
  const [aperto, setAperto] = useState<string | null>(null)
  const tD = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tCr = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (tD.current) clearTimeout(tD.current); if (tCr.current) clearTimeout(tCr.current) }, [])

  const caricaThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/consultant-messages?consultantId=${id}`)
    if (res.ok) { const m: ConsultantMessage[] = await res.json(); setThread(t => ({ ...t, [id]: m })) }
  }, [])
  const carica = useCallback(async () => {
    const res = await fetch('/api/users?role=consulente_lavoro')
    if (!res.ok) { toast({ title: 'Consulenti non caricati', variant: 'destructive' }); setLista([]); return }
    const cs: Consulente[] = await res.json()
    setLista(cs)
    // Le bacheche private servono già nell'elenco (messaggi da leggere).
    cs.forEach(c => caricaThread(c.id))
  }, [caricaThread])
  useEffect(() => { carica() }, [carica])

  // Realtime: risposte del consulente e messaggi eliminati compaiono subito.
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase.channel('consultant-messages-manager')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultant_messages', filter: `manager_id=eq.${managerId}` }, p => {
        if (p.eventType === 'INSERT') {
          const m = p.new as ConsultantMessage
          setThread(t => (!(m.consultant_id in t) || t[m.consultant_id].some(x => x.id === m.id) ? t : { ...t, [m.consultant_id]: [m, ...t[m.consultant_id]] }))
        } else if (p.eventType === 'DELETE') {
          const id = (p.old as { id: string }).id
          setThread(t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.filter(m => m.id !== id)])))
        } else if (p.eventType === 'UPDATE') {
          const m = p.new as ConsultantMessage
          setThread(t => (m.consultant_id in t ? { ...t, [m.consultant_id]: t[m.consultant_id].map(x => (x.id === m.id ? m : x)) } : t))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [managerId])

  const nonLetti = (id: string) => (thread[id] ?? []).filter(m => !m.sent_by_manager && !m.read_at).length
  const nomeLoc = (id: string) => restaurants.find(r => r.id === id)?.name ?? ''
  const righe: RigaAltro[] = (lista ?? []).map(c => {
    const n = nonLetti(c.id), ids = c.consultant_restaurant_ids ?? []
    return {
      key: c.id, a: c.full_name, as: c.username ?? '—', lc: GRIGIO_TUTTI,
      b: n ? `${n} da leggere` : String((thread[c.id] ?? []).length), cc: n ? 'var(--warn)' : undefined, c: dataCorta(c.last_active_at),
      t: ids.length === 1 ? nomeLoc(ids[0]) || '1 locale' : `${ids.length} locali`, tono: n ? 'warn' : 'neu',
    }
  })

  // ── Messaggi ───────────────────────────────────────────────────────────
  async function apriMessaggio(c: Consulente, m: ConsultantMessage) {
    setAperto(a => (a === m.id ? null : m.id))
    if (!m.sent_by_manager && !m.read_at) {
      const res = await fetch(`/api/consultant-messages/${m.id}/read`, { method: 'POST' })
      if (res.ok) { const { read_at } = await res.json(); setThread(t => ({ ...t, [c.id]: (t[c.id] ?? []).map(x => (x.id === m.id ? { ...x, read_at } : x)) })) }
    }
  }
  async function scarica(c: Consulente, m: ConsultantMessage, att: { name: string; path: string }) {
    const res = await fetch(`/api/consultant-messages/${m.id}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(att) })
    if (!res.ok) { toast({ title: 'Impossibile generare il link', variant: 'destructive' }); return }
    const { signedUrl, downloaded_at } = await res.json()
    if (downloaded_at) setThread(t => ({ ...t, [c.id]: (t[c.id] ?? []).map(x => (x.id === m.id ? { ...x, downloaded_at } : x)) }))
    const a = document.createElement('a'); a.href = signedUrl; a.download = att.name; document.body.appendChild(a); a.click(); a.remove()
  }
  async function eliminaMessaggio(c: Consulente, m: ConsultantMessage) {
    if (!(await chiediConferma({ titolo: 'Eliminare il messaggio?', testo: m.attachments?.length ? "Anche l'allegato viene rimosso definitivamente." : 'Il messaggio sparisce anche per il consulente.' }))) return
    const res = await fetch(`/api/consultant-messages?id=${m.id}`, { method: 'DELETE' })
    if (!res.ok) { toast({ title: 'Eliminazione non riuscita', variant: 'destructive' }); return }
    setThread(t => ({ ...t, [c.id]: (t[c.id] ?? []).filter(x => x.id !== m.id) }))
    toast({ title: 'Messaggio eliminato' })
  }

  const fm = useUscita<StatoMsg>()
  const NM = fm.dati
  const [fase, setFase] = useState<'no' | 'pdf' | 'invio'>('no')
  const setM = (x: Partial<StatoMsg>) => fm.setDati(d => (d ? { ...d, ...x } : d))
  const totale = NM ? NM.file.reduce((s, f) => s + f.size, 0) : 0
  async function invia() {
    if (!NM || !NM.titolo.trim() || !NM.corpo.trim()) return
    if (totale > MAX_BYTES) { toast({ title: 'Allegati oltre 10 MB', variant: 'destructive' }); return }
    try {
      const attachments: { name: string; path: string }[] = []
      if (NM.file.length) {
        // Tutti gli allegati diventano un unico PDF compresso, poi si carica.
        setFase('pdf')
        const pdf = await generateUnifiedPDF(NM.file)
        setFase('invio')
        const fd = new FormData(); fd.append('file', pdf); fd.append('consultantId', NM.cid)
        const up = await fetch('/api/consultant-messages/upload', { method: 'POST', body: fd })
        if (!up.ok) throw new Error((await up.json().catch(() => ({}))).error ?? 'Caricamento non riuscito')
        attachments.push({ name: pdf.name, path: (await up.json()).path })
      } else setFase('invio')
      const res = await fetch('/api/consultant-messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultantId: NM.cid, title: NM.titolo.trim(), body: NM.corpo.trim(), attachments, reply_to_id: NM.risposta?.id ?? null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Invio non riuscito')
      await caricaThread(NM.cid)
      fm.chiudi()
      toast({ title: 'Messaggio inviato' })
    } catch (e) {
      toast({ title: 'Messaggio non inviato', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setFase('no')
    }
  }

  // ── Consulente: nuovo / modifica ──────────────────────────────────────
  const ff = useUscita<StatoForm>()
  const NF = ff.dati
  const [salvando, setSalvando] = useState(false)
  const [confElimina, setConfElimina] = useState(false)
  const setF = (x: Partial<StatoForm>) => ff.setDati(d => (d ? { ...d, ...x } : d))
  const userF = NF ? (NF.u != null ? NF.u : usernameDa(NF.t, (lista ?? []).map(c => c.username ?? ''))) : ''
  const okF = !!NF && !!NF.t.trim() && !!userF
  const cr = useUscita<StatoCredenziali>()

  async function salva() {
    if (!NF || !okF) return
    setSalvando(true)
    const campi = { full_name: NF.t.trim(), role: 'consulente_lavoro', consultant_restaurant_ids: NF.locali, can_view_hours: NF.ore, can_post_bulletin: false }
    try {
      const res = await fetch('/api/users', {
        method: NF.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(NF.id ? { id: NF.id, ...campi } : { ...campi, username: userF, password: NF.pw }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Salvataggio non riuscito')
      if (NF.id && NF.pw) {
        const r2 = await fetch('/api/users/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: NF.id, password: NF.pw }) })
        if (!r2.ok) throw new Error((await r2.json().catch(() => ({}))).error ?? 'Password non aggiornata')
      }
      ff.chiudi()
      await carica()
      if (NF.pw) {
        const c: StatoCredenziali = { nome: NF.t.trim(), user: userF, pw: NF.pw, modo: NF.id ? 'reset' : 'nuovo', chiede: false }
        if (tCr.current) clearTimeout(tCr.current)
        tCr.current = setTimeout(() => cr.apri(c), USCITA + 20)
      } else toast({ title: `Dati di ${NF.t.trim()} aggiornati` })
    } catch (e) {
      toast({ title: NF.id ? 'Modifica non riuscita' : 'Consulente non creato', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSalvando(false)
    }
  }
  async function elimina() {
    if (!NF?.id) return
    if (!confElimina) { setConfElimina(true); return }
    setSalvando(true)
    const res = await fetch(`/api/users?id=${NF.id}`, { method: 'DELETE' })
    setSalvando(false)
    if (!res.ok) { toast({ title: 'Eliminazione non riuscita', variant: 'destructive' }); return }
    ff.chiudi(); setSel(null)
    toast({ title: 'Consulente eliminato' })
    carica()
  }

  // ── Dettaglio ──────────────────────────────────────────────────────────
  const c = (lista ?? []).find(x => x.id === sel)
  let d: DatiDettaglio | null = null
  if (c) {
    const msgs = thread[c.id] ?? []
    // Messaggi principali dal più recente, risposte sotto il loro messaggio.
    const top = msgs.filter(m => !m.reply_to_id).sort((a, b) => b.created_at.localeCompare(a.created_at))
    const risposte = (id: string) => msgs.filter(m => m.reply_to_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at))
    const ordinati = top.flatMap(m => [{ m, r: false }, ...risposte(m.id).map(x => ({ m: x, r: true }))])
    const bacheca: ReactNode = (
      <div className="flex flex-col">
        <span className="pb-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Bacheca privata · {msgs.length}</span>
        {!(c.id in thread) && <span className="py-2 text-[13px] text-muted-foreground">Caricamento dei messaggi…</span>}
        {c.id in thread && !msgs.length && <span className="py-2 text-[13px] text-muted-foreground">Nessun messaggio ancora.</span>}
        <div className="flex flex-col gap-1.5">
          {ordinati.map(({ m, r }) => {
            const nl = !m.sent_by_manager && !m.read_at, on = aperto === m.id
            return (
              <div key={m.id} className={cn('rounded-[10px] border', r && 'ml-5', nl ? 'border-[oklch(0.8_0.06_180)] bg-[oklch(0.97_0.015_180)] dark:bg-[oklch(0.25_0.03_180)]' : 'border-border bg-background')}>
                <button type="button" onClick={() => apriMessaggio(c, m)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left active:scale-[0.99]">
                  <span className="mt-[5px] h-2 w-2 flex-none rounded-full" style={{ background: nl ? 'oklch(0.58 0.12 180)' : 'transparent' }} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn('text-sm', nl ? 'font-semibold' : 'font-medium')}>{r ? '↳ ' : ''}{m.title}</span>
                    <span className="text-xs text-muted-foreground">{m.sent_by_manager ? 'Da te' : 'Da ' + c.full_name} · {data(m.created_at)}{m.attachments?.length ? ' · allegato' : ''}</span>
                  </span>
                </button>
                {on && (
                  <div className="anim-swapin flex flex-col gap-2 border-t border-border px-3 pb-3 pt-2.5">
                    <span className="whitespace-pre-wrap text-sm leading-[1.45]">{m.body}</span>
                    {m.attachments?.map(a => (
                      <button key={a.path} type="button" onClick={() => scarica(c, m, a)} className="flex h-10 items-center gap-2 self-start rounded-[8px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.98]">{a.name}</button>
                    ))}
                    {m.sent_by_manager && (m.read_at || m.downloaded_at) && (
                      <span className="text-xs text-muted-foreground">{m.read_at ? 'Letto il ' + data(m.read_at) : ''}{m.read_at && m.downloaded_at ? ' · ' : ''}{m.downloaded_at ? 'allegato scaricato il ' + data(m.downloaded_at) : ''}</span>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => fm.apri({ cid: c.id, titolo: `Re: ${m.title}`, corpo: '', file: [], risposta: m })} className="flex h-10 items-center rounded-[8px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.98]">Rispondi</button>
                      <button type="button" onClick={() => eliminaMessaggio(c, m)} className="flex h-10 items-center rounded-[8px] border border-[oklch(0.85_0.05_25)] px-3 text-[13px] font-medium text-neg active:scale-[0.98] dark:border-[oklch(0.45_0.08_25)]">Elimina</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
    d = {
      titolo: c.full_name, sotto: 'Consulente del lavoro' + (c.username ? ' · ' + c.username : ''), tag: c.can_view_hours ? 'Presenze e ore' : 'Presenze', tono: 'tl',
      sezioni: [{
        h: 'Accesso', righe: [
          { l: 'Ultimo accesso', v: data(c.last_active_at) },
          { l: 'Locali autorizzati', v: (c.consultant_restaurant_ids ?? []).map(nomeLoc).filter(Boolean).join(', ') || 'Nessuno' },
          { l: 'Report ore', v: c.can_view_hours ? 'Sì' : 'No' },
        ],
        coda: <div className="pt-4">{bacheca}</div>,
      }],
      azioni: [
        { l: 'Nuovo messaggio', stile: 'contorno', onClick: () => fm.apri({ cid: c.id, titolo: '', corpo: '', file: [], risposta: null }) },
        { l: 'Modifica', stile: 'nero', onClick: () => { setConfElimina(false); ff.apri({ id: c.id, t: c.full_name, u: c.username ?? '', pw: '', locali: c.consultant_restaurant_ids ?? [], ore: c.can_view_hours }) }, disabilitata: disabilitato },
      ],
    }
  }

  return (
    <div className="relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <BarraAltro schede={schede} kpis={[{ l: 'Consulenti', v: lista ? String(lista.length) : '—' }, { l: 'Da leggere', v: String((lista ?? []).reduce((s, x) => s + nonLetti(x.id), 0)) }]}
        nuovo={{ l: 'Nuovo consulente', disabilitato, onClick: () => { setConfElimina(false); ff.apri({ id: null, t: '', u: null, pw: generaPassword(), locali: [], ore: false }) } }} />
      <GrigliaAltro>
        <ElencoAltro
          testate={[{ l: 'Consulente', a: 'left' }, { l: 'Messaggi', a: 'right' }, { l: 'Ultimo accesso', a: 'right' }, { l: 'Locali', a: 'right' }]}
          colonne="minmax(0,1.4fr) 110px 110px 132px" righe={righe} scelta={sel}
          onScegli={k => { if (tD.current) clearTimeout(tD.current); setEsceD(false); setSel(k); setAperto(null) }}
          vuoto={lista ? { t: 'Nessun consulente', s: 'Crea l’accesso del consulente del lavoro con Nuovo consulente.' } : { t: 'Caricamento…', s: '' }}
        />
        <PannelloDettaglio d={d} chiave={`cons|${sel}`} esce={esceD} onChiudi={() => { setEsceD(true); if (tD.current) clearTimeout(tD.current); tD.current = setTimeout(() => { setSel(null); setEsceD(false) }, USCITA) }} />
      </GrigliaAltro>

      <FoglioAltro aperto={!!NF} esce={ff.esce} onChiudi={() => ff.chiudi()} testata={<TestataFoglio titolo={NF?.id ? 'Modifica consulente' : 'Nuovo consulente'} onChiudi={() => ff.chiudi()} />}>
        {NF && (
          <CorpoFoglio>
            <Campo etichetta="Nome e cognome"><Testo value={NF.t} onChange={v => setF({ t: v })} placeholder="Es. Studio Rossi" /></Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etichetta="Username">
                {NF.id
                  ? <div className={cn(CLASSE_INPUT, 'flex items-center bg-background font-mono font-medium text-muted-foreground')}>{userF}</div>
                  : <Testo mono autoCapitalize="none" value={userF} onChange={v => setF({ u: v.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} />}
              </Campo>
              <Campo etichetta="Password">
                <div className="box-border flex h-[52px] items-center gap-0.5 rounded-[6px] border border-line-strong bg-background pl-3.5 pr-1">
                  <span key={NF.pw || 'inv'} className={cn('anim-swapin min-w-0 flex-1 truncate font-mono text-lg font-medium tracking-[.06em]', !NF.pw && 'text-base tracking-normal text-muted-foreground')}>{NF.pw || 'invariata'}</span>
                  <button type="button" aria-label="Rigenera password" onClick={() => setF({ pw: generaPassword() })} className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] text-[oklch(0.35_0.01_250)] active:scale-[0.94] dark:text-[oklch(0.8_0.01_250)]">{ICONA_RIGENERA}</button>
                </div>
              </Campo>
            </div>
            <GruppoPillole etichetta="Locali autorizzati" opzioni={restaurants.map(r => ({ v: r.id, l: r.name }))} scelte={NF.locali}
              onTocca={v => setF({ locali: NF.locali.includes(v) ? NF.locali.filter(x => x !== v) : [...NF.locali, v] })} />
            <GruppoPillole etichetta="Report ore" opzioni={[{ v: 'si', l: 'Sì' }, { v: 'no', l: 'Solo presenze' }]} scelte={[NF.ore ? 'si' : 'no']} onTocca={v => setF({ ore: v === 'si' })} />
            <Nota>{NF.id ? 'Rigenera la password solo se va cambiata: dopo il salvataggio la vedi per condividerla.' : 'La password è generata: la rivedi dopo il salvataggio per condividerla con il consulente.'}</Nota>
            <PulsantiSalva onAnnulla={() => ff.chiudi()} onSalva={salva} etichetta={NF.id ? 'Salva modifiche' : 'Crea accesso'} attivo={okF} occupato={salvando}
              elimina={NF.id ? { conferma: confElimina, onClick: elimina } : undefined} />
          </CorpoFoglio>
        )}
      </FoglioAltro>

      <FoglioAltro aperto={!!NM} esce={fm.esce} onChiudi={() => { if (fase === 'no') fm.chiudi() }} testata={<TestataFoglio titolo={NM?.risposta ? 'Rispondi' : 'Nuovo messaggio'} onChiudi={() => { if (fase === 'no') fm.chiudi() }} />}>
        {NM && (
          <CorpoFoglio>
            {NM.risposta && (
              <div className="flex items-start gap-2 rounded-[10px] bg-background px-3.5 py-3 text-[13px]">
                <span className="min-w-0 flex-1"><span className="text-muted-foreground">In risposta a </span><span className="font-medium">“{NM.risposta.title}”</span></span>
                <button type="button" aria-label="Annulla risposta" onClick={() => setM({ risposta: null })} className="-m-1 flex h-8 w-8 flex-none items-center justify-center text-muted-foreground">{ICONA_X}</button>
              </div>
            )}
            <Campo etichetta="Oggetto"><Testo value={NM.titolo} onChange={v => setM({ titolo: v })} placeholder="Es. Buste paga di ottobre" /></Campo>
            <Campo etichetta="Messaggio">
              <textarea value={NM.corpo} onChange={e => setM({ corpo: e.target.value })} placeholder="Scrivi al consulente…" className={cn(CLASSE_INPUT, 'h-[110px] resize-none py-3 text-[15px] leading-[1.45]')} />
            </Campo>
            <Campo etichetta="Allegati">
              <label className={cn('flex h-[52px] cursor-pointer items-center justify-center rounded-[6px] border border-dashed border-line-strong text-sm font-medium text-muted-foreground active:scale-[0.98]', fase !== 'no' && 'pointer-events-none opacity-40')}>
                + Aggiungi file o foto
                <input type="file" multiple className="hidden" onChange={e => {
                  const nuovi = Array.from(e.target.files ?? []); e.target.value = ''
                  const tutti = [...NM.file, ...nuovi]
                  if (tutti.reduce((s, f) => s + f.size, 0) > MAX_BYTES) { toast({ title: 'Il limite degli allegati è 10 MB in totale', variant: 'destructive' }); return }
                  setM({ file: tutti })
                }} />
              </label>
              {NM.file.map((f, i) => (
                <div key={f.name + i} className="flex h-10 items-center gap-2 rounded-[8px] bg-background pl-3 pr-1 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{Math.round(f.size / 1024)} KB</span>
                  <button type="button" aria-label="Togli" onClick={() => setM({ file: NM.file.filter((_, j) => j !== i) })} className="flex h-8 w-8 items-center justify-center text-muted-foreground">{ICONA_X}</button>
                </div>
              ))}
            </Campo>
            <Nota>{fase === 'pdf' ? 'Unisco gli allegati in un PDF…' : 'Gli allegati vengono uniti in un unico PDF (massimo 10 MB). Il consulente riceve il messaggio nella sua area.'}</Nota>
            <PulsantiSalva onAnnulla={() => fm.chiudi()} onSalva={invia} etichetta={fase === 'pdf' ? 'Preparo il PDF…' : fase === 'invio' ? 'Invio…' : 'Invia'} attivo={!!NM.titolo.trim() && !!NM.corpo.trim()} occupato={fase !== 'no'} />
          </CorpoFoglio>
        )}
      </FoglioAltro>

      <FoglioCredenziali cr={cr.dati} esce={cr.esce} onChiudi={() => cr.chiudi()} onRigenera={() => {}} onImposta={() => {}} />
    </div>
  )
}
