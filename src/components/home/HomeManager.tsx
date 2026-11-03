import Link from 'next/link'
import { cn } from '@/lib/utils'
import { percento, type DatiHome, type LocaleHome } from '@/lib/homeManager'
import { Sparkline } from './Sparkline'
import { DaFare } from './DaFare'

const eur0 = (n: number) => `€ ${n.toLocaleString('it-IT', { maximumFractionDigits: 0 })}`
const eur2 = (n: number) => `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Delta({ p, testo }: { p: number | null; testo: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {p !== null && (
        <span className={cn('rounded-full px-1.5 py-px font-mono text-[10px] font-semibold', p >= 0 ? 'bg-ok-tint text-ok' : 'bg-neg-tint text-neg')}>
          {p >= 0 ? '+' : ''}{p.toFixed(1).replace('.', ',')}%
        </span>
      )}
      {testo}
    </span>
  )
}

function PerLocale({ locali, valore }: { locali: LocaleHome[]; valore: (l: LocaleHome) => number | null }) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
      {locali.map(l => {
        const v = valore(l)
        return (
          <span key={l.id} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: l.colore }} /><span className="truncate">{l.nome}</span></span>
            <span className={cn('font-mono', v === null && 'text-neg')}>{v === null ? 'manca' : eur0(v)}</span>
          </span>
        )
      })}
    </div>
  )
}

function Scheda({ titolo, valore, href, children }: { titolo: string; valore: string; href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="anim-inrise flex flex-col gap-1.5 rounded-[12px] border border-border bg-card p-4 active:scale-[0.99]">
      <span className="flex items-center justify-between text-xs text-muted-foreground">
        {titolo}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
      </span>
      <span className="font-mono text-[22px] font-medium">{valore}</span>
      {children}
    </Link>
  )
}

const STATO = {
  inviata: ['Inviata', 'bg-ok-tint text-ok'],
  revisione: ['In revisione', 'bg-warn-tint text-warn'],
  bozza: ['In bozza', 'bg-warn-tint text-warn'],
  mancante: ['Mancante', 'bg-neg-tint text-neg'],
} as const

// Home del manager (design MTHome / Manager Smartphone): riepilogo del
// giorno, quattro indicatori di cassa, tabella dei locali con andamento a
// 7 giorni e la lista "Da fare" con le approvazioni.
export function HomeManager({ d }: { d: DatiHome }) {
  const conIeri = d.locali.filter(l => l.ieri !== null).length
  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-1 lg:px-8">
      <div className="anim-swapin rounded-[14px] border border-[oklch(0.88_0.04_180)] bg-[oklch(0.97_0.02_180)] px-[18px] py-3.5 dark:border-[oklch(0.35_0.05_180)] dark:bg-[oklch(0.22_0.03_180)]">
        <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-[oklch(0.4_0.08_180)] dark:text-[oklch(0.8_0.08_180)]">Riepilogo · {d.ieriLabel}</span>
        <p className="mt-1 text-[15px] leading-[1.5] text-pretty">{d.riepilogo}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Scheda titolo={`Ultima serata · ${d.ieriBreve}`} valore={eur0(d.totaleIeri)} href="/cassa/analisi">
          <Delta p={percento(d.totaleIeri, d.totaleIeriPrima)} testo={`vs settimana prima · ${conIeri} su ${d.locali.length} locali`} />
          <PerLocale locali={d.locali} valore={l => l.ieri} />
        </Scheda>
        <Scheda titolo="Mese fino a ieri" valore={eur0(d.totaleMese)} href="/cassa/analisi">
          <Delta p={percento(d.totaleMese, d.totaleMesePrima)} testo="vs stessi giorni del mese prima" />
          <PerLocale locali={d.locali} valore={l => l.mese} />
        </Scheda>
        <Scheda titolo={`Media scontrino · ${d.ieriBreve}`} valore={d.mediaIeri === null ? '—' : eur2(d.mediaIeri)} href="/cassa/analisi">
          <Delta p={percento(d.mediaIeri, d.mediaPrima)} testo="vs settimana prima" />
        </Scheda>
        <Scheda titolo={`Contanti per banca · ${d.ieriBreve}`} valore={eur2(d.contantiIeri)} href="/cassa/progressivo-buste">
          <PerLocale locali={d.locali} valore={l => l.contantiBanca} />
        </Scheda>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <div className="flex items-baseline gap-2.5 border-b border-border px-[18px] py-3.5">
            <span className="text-[17px] font-semibold">Locali</span>
            <span className="text-[13px] text-muted-foreground">{d.ieriBreve}</span>
          </div>
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_100px_110px_96px] gap-3 border-b border-border bg-background px-[18px] py-2.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-muted-foreground md:grid">
            <span>Locale</span><span className="text-right">Incasso</span><span>7 giorni</span><span className="text-right">Contanti</span><span className="text-right">Chiusura</span>
          </div>
          {d.locali.map(l => {
            const p = percento(l.ieri, l.ieriPrima)
            const [st, cls] = STATO[l.stato]
            return (
              <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border px-[18px] py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_110px_100px_110px_96px]">
                <span className="flex items-center gap-2 text-[15px]"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: l.colore }} />{l.nome}</span>
                <span className="flex flex-col items-end">
                  <span className="font-mono text-[15px] font-medium">{l.ieri === null ? '—' : eur0(l.ieri)}</span>
                  <span className={cn('font-mono text-[10px]', l.ieri === null ? 'text-neg' : 'text-muted-foreground')}>
                    {l.ieri === null ? 'chiusura non inviata' : p !== null ? `${p >= 0 ? '+' : ''}${p.toFixed(1).replace('.', ',')}% vs sett. prima` : ''}
                  </span>
                </span>
                <span className="hidden md:block"><Sparkline valori={l.andamento} colore={l.colore} /></span>
                <span className="hidden text-right font-mono text-sm md:block">{l.contantiBanca === null ? '—' : eur2(l.contantiBanca)}</span>
                <span className="col-span-2 flex justify-end md:col-span-1"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.04em]', cls)}>{st}</span></span>
              </div>
            )
          })}
        </div>
        <div className="lg:max-h-[560px]">
          <DaFare voci={d.daFare} />
        </div>
      </div>
    </div>
  )
}
