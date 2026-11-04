'use client'
import { useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/presenze/comuni'

// Presenze di oggi in sola lettura (Riepilogo del capo servizio): stesse
// righe della scheda Presenze del design (MTPresenze) — avatar, nome,
// blocchi orari e badge "In corso" con il contatore che scorre.

const TZ = 'Europe/Rome'

export type PresenzaPreviewRow = {
  id:        string
  user_id:   string
  check_in:  string
  check_out: string | null
  profile?:  { id: string; full_name: string } | null
}

interface Props {
  initialRows: PresenzaPreviewRow[]
  /** Non più usati: la lista è in sola lettura per tutti (vedi Riepilogo). */
  dipendenti?: { id: string; full_name: string }[]
  isDirettore?: boolean
}

const ora = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'HH:mm')
const hh = (m: number) => Math.floor(m / 60) + 'h ' + String(Math.floor(m % 60)).padStart(2, '0')

export function PresenzePreviewClient({ initialRows }: Props) {
  const [adesso, setAdesso] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setAdesso(Date.now()), 1000); return () => clearInterval(t) }, [])

  const perUtente = new Map<string, PresenzaPreviewRow[]>()
  for (const r of [...initialRows].sort((a, b) => a.check_in.localeCompare(b.check_in))) perUtente.set(r.user_id, [...(perUtente.get(r.user_id) ?? []), r])
  const righe = [...perUtente.values()]
  const min = (r: PresenzaPreviewRow) => Math.max(0, ((r.check_out ? new Date(r.check_out).getTime() : adesso) - new Date(r.check_in).getTime()) / 60000)

  return (
    <div className="anim-swapin mt-6 flex flex-col overflow-hidden rounded-[12px] border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3.5">
        <span className="text-[17px] font-semibold">Presenze di oggi</span>
        <span className="font-mono text-[13px] font-medium text-muted-foreground">{righe.length || ''}</span>
      </div>
      {righe.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
          <span className="text-[15px] font-semibold">Nessuna presenza registrata oggi</span>
          <span className="text-[13px] text-muted-foreground">Le timbrature compaiono qui appena arrivano.</span>
        </div>
      ) : righe.map(bl => {
        const nome = bl[0].profile?.full_name ?? '—'
        const tot = bl.reduce((s, r) => s + min(r), 0)
        return (
          <div key={bl[0].user_id} className="grid min-h-16 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-[oklch(0.94_0.01_250)] px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[40px_minmax(0,1fr)_minmax(0,1.4fr)_90px] sm:gap-3.5 sm:px-[18px] sm:py-2 dark:border-border">
            <Avatar nome={nome} className="row-[1/3] h-9 w-9 self-start sm:row-auto sm:h-10 sm:w-10" />
            <span className="truncate text-[15px] font-medium">{nome}</span>
            <div className="col-[2/4] row-[2] flex flex-wrap items-center gap-1.5 sm:col-auto sm:row-auto">
              {bl.map(b => {
                const lv = !b.check_out, x = min(b), s = Math.floor(((adesso - new Date(b.check_in).getTime()) / 1000) % 60)
                return (
                  <span key={b.id} className={cn('flex h-9 items-center gap-2 rounded-[8px] border px-3 font-mono text-[13px] font-medium',
                    lv ? 'border-[oklch(0.85_0.06_150)] bg-[oklch(0.97_0.025_150)] dark:border-ok/40 dark:bg-ok-tint/50' : 'border-[oklch(0.9_0.01_250)] bg-[oklch(0.975_0.01_250)] dark:border-border dark:bg-secondary')}>
                    {ora(b.check_in)} → {b.check_out ? ora(b.check_out) : ''}
                    {lv && <span className="rounded-full bg-ok-tint px-[7px] py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[.05em] text-ok">In corso {Math.floor(x / 60)}:{String(Math.floor(x % 60)).padStart(2, '0')}:{String(Math.max(0, s)).padStart(2, '0')}</span>}
                  </span>
                )
              })}
              {bl.length > 1 && <span className="rounded-full bg-[oklch(0.93_0.01_250)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary">Spezzato</span>}
            </div>
            <span className="col-[3] row-[1] text-right font-mono text-sm font-semibold sm:col-auto">{hh(tot)}</span>
          </div>
        )
      })}
    </div>
  )
}
