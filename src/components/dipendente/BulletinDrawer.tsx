'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Foglio } from './Foglio'

const TZ = 'Europe/Rome'

type Comunicato = {
  id: string
  title: string
  body: string
  created_at: string
  created_by: string | null
  author?: { full_name: string; role: string; is_direttore: boolean | null } | null
}

interface Props {
  userId: string
  onClose: () => void
}

const RUOLI: Record<string, string> = { manager: 'Manager', capo_servizio: 'Capo servizio' }

// Autore come nei messaggi del design: "Manager · Paolo", "Direzione", "Tu".
function autore(c: Comunicato, userId: string): string {
  if (c.created_by === userId) return 'Tu'
  const a = c.author
  if (!a) return 'Direzione'
  if (a.role === 'capo_servizio' && a.is_direttore) return 'Direzione'
  const nome = a.full_name?.split(' ')[0]
  const ruolo = RUOLI[a.role] ?? 'Direzione'
  return nome ? `${ruolo} · ${nome}` : ruolo
}

// Ora relativa del design: "oggi 15:20", "ieri 23:40", "lun 9:00".
function quando(iso: string): string {
  const d = new Date(iso)
  const giorno = formatInTimeZone(d, TZ, 'yyyy-MM-dd')
  const oggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const ieri = formatInTimeZone(new Date(Date.now() - 86_400_000), TZ, 'yyyy-MM-dd')
  const ora = formatInTimeZone(d, TZ, 'H:mm')
  if (giorno === oggi) return `oggi ${ora}`
  if (giorno === ieri) return `ieri ${ora}`
  if (Date.now() - d.getTime() < 6 * 86_400_000) return `${formatInTimeZone(d, TZ, 'EEE', { locale: it })} ${ora}`
  return formatInTimeZone(d, TZ, 'd MMM', { locale: it })
}

// Bacheca del dipendente nel foglio del design, con le righe dei
// "Messaggi" del capo servizio: pallino blu sui non letti, autore,
// ora, testo. Aprirla vale come lettura (ricevuta in bulletin_reads).
export function BulletinDrawer({ userId, onClose }: Props) {
  const [comunicati, setComunicati] = useState<Comunicato[] | null>(null)
  const [letti, setLetti] = useState<Set<string>>(new Set())

  useEffect(() => {
    try { localStorage.setItem('bulletins_last_seen', new Date().toISOString()) } catch {}
    const supabase = createClient()
    let vivo = true
    Promise.all([
      supabase
        .from('bulletins')
        .select('id, title, body, created_at, created_by, author:profiles!created_by(full_name, role, is_direttore)')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('bulletin_reads').select('bulletin_id').eq('user_id', userId),
    ]).then(([{ data }, { data: reads }]) => {
      if (!vivo) return
      const lista = (data as unknown as Comunicato[]) ?? []
      const giaLetti = new Set((reads ?? []).map(r => r.bulletin_id as string))
      setComunicati(lista)
      setLetti(giaLetti)
      const nuovi = lista.filter(c => !giaLetti.has(c.id))
      if (nuovi.length) {
        supabase
          .from('bulletin_reads')
          .upsert(nuovi.map(c => ({ bulletin_id: c.id, user_id: userId })), { onConflict: 'bulletin_id,user_id', ignoreDuplicates: true })
          .then(() => {})
      }
    })
    return () => { vivo = false }
  }, [userId])

  return (
    <Foglio titolo="Bacheca" onClose={onClose}>
      {() => (
        <div className="flex flex-col">
          {comunicati === null ? (
            <div className="flex flex-col">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex flex-col gap-2 border-b border-border p-3.5">
                  <div className="skeleton-shimmer h-3 w-1/3 rounded-[3px]" />
                  <div className="skeleton-shimmer h-3.5 w-full rounded-[5px]" />
                  <div className="skeleton-shimmer h-3.5 w-2/3 rounded-[5px]" />
                </div>
              ))}
            </div>
          ) : comunicati.length === 0 ? (
            <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center">
              <span className="text-[15px] font-semibold">Nessun comunicato</span>
              <span className="text-[13px] text-muted-foreground">I messaggi del locale compaiono qui.</span>
            </div>
          ) : comunicati.map((c, i) => (
            <div
              key={c.id}
              className="flex flex-col gap-1.5 border-b border-border p-3.5 last:border-b-0"
              style={{ animation: 'inrise 600ms cubic-bezier(0.16,1,0.3,1) both', animationDelay: `${i * 70}ms` }}
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: letti.has(c.id) ? 'transparent' : 'var(--turni)' }} />
                <span className="flex-1 truncate text-[13px] font-semibold">{autore(c, userId)}</span>
                <span className="flex-none font-mono text-xs text-muted-foreground">{quando(c.created_at)}</span>
              </div>
              <span className="whitespace-pre-wrap text-[15px] leading-[1.45] [text-wrap:pretty]">
                {c.title && <span className="font-semibold">{c.title}{c.body ? ' · ' : ''}</span>}
                {c.body}
              </span>
            </div>
          ))}
        </div>
      )}
    </Foglio>
  )
}
