'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { impostaSottotitolo } from '@/components/shell/intestazioneDinamica'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { Contenitore, NavMese, Pillola, useTelefono, eur, dataBreve, dataNum, meseNome, type Tono } from '@/components/cassa/comuni'
import { cn } from '@/lib/utils'

// Lista chiusure del cassiere (Cassiere e Dipendente 3b): Giorno, Incasso,
// Stato. Toccando una riga si apre la chiusura: il dettaglio inviato si
// corregge con revisione del manager, una bozza riprende dalla fase 1.

const TZ = 'Europe/Rome'
interface Riga { id: string; data: string; totale_entrate: number; contanti_per_banca: number; stato: string }

export function ListaChiusureClient({ restaurant }: { restaurant: { id: string; name: string } | null }) {
  const tel = useTelefono()
  const router = useRouter()
  const meseOggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [mese, setMese] = useState(meseOggi)
  const [righe, setRighe] = useState<Riga[]>([])
  const [revisione, setRevisione] = useState<Set<string>>(new Set())
  const [errore, setErrore] = useState(false)
  const { stato: sk, avvia, pronto } = useScheletro()

  useEffect(() => { impostaSottotitolo(meseNome(`${mese}-01`)) }, [mese])
  useEffect(() => () => impostaSottotitolo(null), [])

  const req = useRef(0)
  const carica = useCallback(async () => {
    if (!restaurant) { setRighe([]); pronto(); return }
    const mio = ++req.current
    const [y, m] = mese.split('-').map(Number)
    const fine = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const sb = createClient()
    const { data, error } = await sb.from('cassa_chiusure').select('id, data, totale_entrate, contanti_per_banca, stato')
      .eq('restaurant_id', restaurant.id).gte('data', `${mese}-01`).lte('data', fine).order('data', { ascending: false })
    if (req.current !== mio) return
    if (error) { setErrore(true); pronto(); return }
    const rs = (data ?? []) as Riga[]
    const ids = rs.filter(r => r.stato === 'confermata').map(r => r.id)
    const { data: md } = ids.length
      ? await sb.from('cassa_chiusure_modifiche').select('chiusura_id').in('chiusura_id', ids).eq('stato', 'in_attesa')
      : { data: [] }
    if (req.current !== mio) return
    setErrore(false)
    setRighe(rs)
    setRevisione(new Set(((md ?? []) as { chiusura_id: string }[]).map(x => x.chiusura_id)))
    pronto()
  }, [restaurant, mese, pronto])

  useEffect(() => { carica() }, [carica])
  useEffect(() => {
    const sb = createClient()
    const ch = sb.channel('cassa_lista_cassiere')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure' }, () => carica())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure_modifiche' }, () => carica())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [carica])

  const stato = (r: Riga): [string, Tono] => r.stato !== 'confermata' ? ['In bozza', 'warn'] : revisione.has(r.id) ? ['In revisione', 'warn'] : ['Confermata', 'ok']
  const apri = (r: Riga) => router.push(`/cassa/chiusura?restaurant_id=${restaurant?.id}&data=${r.data}`)
  const colonne = tel ? 'grid-cols-[56px_1fr_auto]' : 'grid-cols-[minmax(0,1.3fr)_140px_140px_128px]'

  return (
    <Contenitore>
      <div className={cn('flex flex-none items-center gap-3 pb-3', tel ? 'px-4 pt-2' : 'px-8 pt-1')}>
        <NavMese mese={mese} min="2020-01" max={meseOggi} onCambia={m => { avvia(); setMese(m) }} className={tel ? 'flex-1' : ''} />
      </div>
      <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className={cn('relative flex min-h-0 flex-1 flex-col', tel ? 'px-4' : 'px-8')}>
        <div className="anim-swapin flex max-h-full min-h-0 flex-col overflow-hidden rounded-[14px] border border-border bg-card">
          <div className={cn('grid flex-none gap-2.5 border-b border-border px-3.5 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[.5px] text-muted-foreground', colonne)}>
            <span>Giorno</span><span className="text-right">Incasso</span>{!tel && <span className="text-right">Busta</span>}<span className="w-[84px] justify-self-end text-right">Stato</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {errore ? (
              <div className="flex flex-col items-center gap-1 px-[18px] py-12 text-center">
                <span className="text-[15px] font-semibold text-neg">Caricamento non riuscito</span>
                <button type="button" onClick={carica} className="mt-3 flex h-11 items-center rounded-[12px] border border-line-strong px-[18px] text-sm font-semibold active:scale-[0.97]">Riprova</button>
              </div>
            ) : righe.length === 0 && sk === 'no' ? (
              <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
                <span className="text-[15px] font-semibold">Nessuna chiusura a {meseNome(`${mese}-01`).toLowerCase()}</span>
                <span className="text-[13px] text-muted-foreground">Le chiusure inviate compaiono qui, dalla più recente.</span>
              </div>
            ) : righe.map((r, i) => {
              const [s, t] = stato(r)
              return (
                <button key={r.id} type="button" onClick={() => apri(r)}
                  className={cn('anim-swapin grid h-[52px] w-full items-center gap-2.5 border-b border-border px-3.5 text-left transition-transform active:scale-[0.995]', colonne)}
                  style={{ animationDelay: `${Math.min(i, 12) * 70}ms` }}>
                  <span className="font-mono text-sm font-medium">{tel ? dataNum(r.data) : dataBreve(r.data)}</span>
                  <span className="text-right font-mono text-[15px] font-medium">{eur(Number(r.totale_entrate))}</span>
                  {!tel && <span className="text-right font-mono text-sm text-muted-foreground">{r.stato === 'confermata' ? eur(Number(r.contanti_per_banca)) : '—'}</span>}
                  <span className="flex w-[84px] justify-end justify-self-end"><Pillola tono={t}>{s}</Pillola></span>
                </button>
              )
            })}
          </div>
        </div>
        {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}
      </div>
    </Contenitore>
  )
}
