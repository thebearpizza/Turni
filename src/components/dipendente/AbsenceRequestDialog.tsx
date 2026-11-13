'use client'
import { CampoCodiceInps } from '@/components/shared/CampoCodiceInps'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { formatInTimeZone } from 'date-fns-tz'
import type { Absence, AbsenceType, AbsenceStatus } from '@/types'
import { Foglio } from './Foglio'

const TZ = 'Europe/Rome'
const GIORNO = 86_400_000

interface Props {
  userId: string
  restaurantId: string | null
  onClose: () => void
}

// Colori dei tipi come in MTAssenze (sfondo, bordo, testo). Il dipendente
// non può segnare un'assenza ingiustificata: la assegna solo il manager.
const TIPI: { k: AbsenceType; l: string; bg: string; bd: string; fg: string }[] = [
  { k: 'ferie', l: 'Ferie', bg: 'oklch(0.93 0.04 290)', bd: 'oklch(0.8 0.07 290)', fg: 'oklch(0.4 0.1 290)' },
  { k: 'malattia', l: 'Malattia', bg: 'oklch(0.93 0.035 250)', bd: 'oklch(0.8 0.06 250)', fg: 'oklch(0.38 0.08 250)' },
  { k: 'riposo', l: 'Riposo', bg: 'oklch(0.93 0.04 25)', bd: 'oklch(0.82 0.07 25)', fg: 'oklch(0.45 0.1 25)' },
]
const TIPO_INGIUSTIFICATA = { l: 'Ingiustificata', bg: 'oklch(0.9 0.02 250)', fg: 'oklch(0.3 0.01 250)' }

const STATI: Record<AbsenceStatus, { l: string; cls: string }> = {
  pending: { l: 'In attesa', cls: 'bg-warn-tint text-warn' },
  approved: { l: 'Approvata', cls: 'bg-ok-tint text-ok' },
  rejected: { l: 'Rifiutata', cls: 'bg-neg-tint text-neg' },
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const GSETT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

// Date come giorni UTC a mezzanotte ("2026-10-20" ↔ ms): niente sorprese
// col cambio dell'ora legale quando si scorre di un giorno.
const daIso = (s: string) => Date.parse(`${s}T00:00:00Z`)
const aIso = (t: number) => new Date(t).toISOString().slice(0, 10)
const fd = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MESI[d.getUTCMonth()]}` }
const fdw = (t: number) => `${GSETT[new Date(t).getUTCDay()]} ${fd(t)}`
const nGiorni = (a: number, b: number) => Math.round((b - a) / GIORNO) + 1
const periodo = (a: number, b: number) => (a === b ? fdw(a) : `Dal ${fd(a)} al ${fd(b)}`) + ` · ${nGiorni(a, b)} ${nGiorni(a, b) === 1 ? 'giorno' : 'giorni'}`

const FRECCIA_SX = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
const FRECCIA_DX = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>

// Richiesta di assenza del dipendente: lo stesso foglio "Nuova assenza"
// del manager (MTAssenze) senza la scelta del dipendente, con la nota per
// il manager e, sotto, lo stato delle proprie richieste recenti.
export function AbsenceRequestDialog({ userId, restaurantId, onClose }: Props) {
  const oggi = daIso(formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
  const [tipo, setTipo] = useState<AbsenceType>('ferie')
  const [dal, setDal] = useState(oggi)
  const [al, setAl] = useState(oggi)
  const [codice, setCodice] = useState('')
  const [note, setNote] = useState('')
  const [invio, setInvio] = useState(false)
  const [mie, setMie] = useState<Absence[] | null>(null)

  const caricaMie = useCallback(async () => {
    const { data } = await createClient()
      .from('absences')
      .select('*')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(5)
    setMie((data ?? []) as Absence[])
  }, [userId])

  useEffect(() => { caricaMie() }, [caricaMie])

  // Se il manager approva o rifiuta mentre il foglio è aperto, lo stato
  // della richiesta si aggiorna senza riaprire.
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase
      .channel(`rt-mie-assenze-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absences', filter: `user_id=eq.${userId}` }, () => { caricaMie() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [userId, caricaMie])

  // Le frecce spostano un giorno alla volta; "Dal" non supera "Al" e
  // viceversa, come nel prototipo.
  const sposta = (campo: 'dal' | 'al', delta: number) => {
    if (campo === 'dal') {
      const v = dal + delta * GIORNO
      setDal(v)
      if (v > al) setAl(v)
    } else {
      const v = al + delta * GIORNO
      setAl(v)
      if (v < dal) setDal(v)
    }
  }

  async function invia(chiudi: () => void) {
    if (invio) return
    setInvio(true)
    const { error } = await createClient().from('absences').insert({
      user_id: userId,
      restaurant_id: restaurantId,
      type: tipo,
      start_date: aIso(dal),
      end_date: aIso(al),
      certificate_code: tipo === 'malattia' && codice ? codice : null,
      notes: note.trim() || null,
      created_by: userId,
      status: 'pending',
    })
    setInvio(false)
    if (error) {
      toast({ title: "Invio non riuscito. Riprova.", variant: 'destructive' })
      return
    }
    toast({ title: 'Richiesta inviata', description: 'Il manager riceverà la tua richiesta' })
    chiudi()
  }

  return (
    <Foglio titolo="Richiedi assenza" onClose={onClose}>
      {chiudi => (
        <div className="flex flex-col gap-4 px-[22px] py-[18px]">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Tipo</span>
            <div className="grid grid-cols-3 gap-1.5">
              {TIPI.map(t => {
                const on = tipo === t.k
                return (
                  <button
                    key={t.k}
                    type="button"
                    onClick={() => setTipo(t.k)}
                    aria-pressed={on}
                    className="flex h-12 items-center justify-center rounded-[8px] border text-center text-[13px] font-medium transition-[background-color] duration-200 active:scale-[0.97]"
                    style={on ? { background: t.bg, borderColor: t.bd, color: t.fg } : { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    {t.l}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([['dal', 'Dal', dal], ['al', 'Al', al]] as const).map(([k, l, v]) => (
              <div key={k} className="flex flex-col gap-2">
                <span className="text-sm font-medium">{l}</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label={`${l}: giorno prima`} onClick={() => sposta(k, -1)} className="flex h-12 w-11 flex-none items-center justify-center rounded-[6px] border border-line-strong active:scale-[0.96]">{FRECCIA_SX}</button>
                  <div className="flex h-12 flex-1 items-center justify-center rounded-[6px] border border-line-strong text-sm font-medium">{fdw(v)}</div>
                  <button type="button" aria-label={`${l}: giorno dopo`} onClick={() => sposta(k, 1)} className="flex h-12 w-11 flex-none items-center justify-center rounded-[6px] border border-line-strong active:scale-[0.96]">{FRECCIA_DX}</button>
                </div>
              </div>
            ))}
          </div>

          {tipo === 'malattia' && <CampoCodiceInps valore={codice} onChange={setCodice} />}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Nota per il manager <span className="font-normal text-muted-foreground">(facoltativa)</span></span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Es. matrimonio di mia sorella"
              className="min-h-[52px] resize-none rounded-[6px] border border-line-strong bg-card px-3.5 py-3 text-[15px] leading-[1.45] outline-none placeholder:text-muted-foreground focus:border-[oklch(0.58_0.12_180)] focus:ring-1 focus:ring-[oklch(0.58_0.12_180)]"
            />
          </div>

          <span className="text-sm font-medium">{nGiorni(dal, al)} {nGiorni(dal, al) === 1 ? 'giorno' : 'giorni'}</span>

          <div className="grid grid-cols-[1fr_2fr] gap-2.5">
            <button type="button" onClick={chiudi} className="flex h-[52px] items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Annulla</button>
            <button
              type="button"
              onClick={() => invia(chiudi)}
              disabled={invio}
              className="flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity active:scale-[0.98] disabled:opacity-60"
            >
              {invio ? 'Invio in corso…' : 'Invia richiesta'}
            </button>
          </div>

          {mie && mie.length > 0 && (
            <div className="mt-2 flex flex-col overflow-hidden rounded-[12px] border border-border">
              <div className="border-b border-border px-3.5 py-3 text-[15px] font-semibold">Le tue richieste</div>
              {mie.map((a, i) => {
                const t = TIPI.find(x => x.k === a.type) ?? TIPO_INGIUSTIFICATA
                const s = STATI[a.status]
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0"
                    style={{ animation: 'inrise 600ms cubic-bezier(0.16,1,0.3,1) both', animationDelay: `${i * 70}ms` }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="self-start rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em]" style={{ background: t.bg, color: t.fg }}>{t.l}</span>
                      <span className="text-sm text-[oklch(0.35_0.01_250)] dark:text-[oklch(0.8_0.01_250)]">{periodo(daIso(a.start_date), daIso(a.end_date))}</span>
                    </span>
                    <span className={cn('flex-none rounded-full px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em]', s.cls)}>{s.l}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Foglio>
  )
}

