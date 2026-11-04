'use client'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { cn } from '@/lib/utils'

const TZ = 'Europe/Rome'
const ICONA_INGRESSO = 'M141.66,133.66l-40,40a8,8,0,0,1-11.32-11.32L116.69,136H24a8,8,0,0,1,0-16h92.69L90.34,93.66a8,8,0,0,1,11.32-11.32l40,40A8,8,0,0,1,141.66,133.66ZM200,32H136a8,8,0,0,0,0,16h56V208H136a8,8,0,0,0,0,16h64a8,8,0,0,0,8-8V40A8,8,0,0,0,200,32Z'
const ICONA_USCITA = 'M120,216a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V40a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H56V208h56A8,8,0,0,1,120,216Zm109.66-93.66-40-40a8,8,0,0,0-11.32,11.32L204.69,120H112a8,8,0,0,0,0,16h92.69l-26.35,26.34a8,8,0,0,0,11.32,11.32l40-40A8,8,0,0,0,229.66,122.34Z'

function durata(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export interface BloccoTimbraturaProps {
  now: Date
  /** Ingresso aperto (ISO) o null prima dell'ingresso. */
  checkIn: string | null
  /** Riga sotto l'ora: turno di oggi o orario d'ingresso. */
  sotto: string
  loading: boolean
  geoStatus: string
  onTimbra: () => void
  gpsFailed: boolean
  errore?: string | null
  onFoto: (e: React.ChangeEvent<HTMLInputElement>) => void
  /** "grande": Home di dipendente e capo servizio; "compatta": riquadro del direttore. */
  variante?: 'grande' | 'compatta'
  onSimula?: () => void
  /** Distanza dal locale dell'ultima verifica GPS, in metri (facoltativa). */
  distanza?: number | null
}

// Riga sotto il pulsante: "Posizione verificata · 24 m dal locale" come nel
// design, appena il GPS ha dato una posizione dentro il raggio.
function rigaGps(geoStatus: string, distanza: number | null | undefined): string {
  if (geoStatus === 'checking') return 'Verifica della posizione in corso'
  if (geoStatus === 'inside') return distanza != null ? `Posizione verificata · ${Math.round(distanza)} m dal locale` : 'Posizione verificata'
  if (geoStatus === 'outside') return distanza != null ? `Fuori dal locale · ${Math.round(distanza)} m` : 'Fuori dal locale'
  if (geoStatus === 'denied' || geoStatus === 'unsupported') return 'Posizione non disponibile'
  return 'La posizione si verifica quando timbri'
}

// Pallino "in servizio": il pulse del design (opacità 1 → .35 in 2 s),
// diverso da quello di Tailwind (.5 con altra curva).
const STILE_PULSE = '@keyframes timbra-pulse{0%,100%{opacity:1}50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.timbra-pulse{animation:none!important}}'

// Blocco di timbratura del design (Dipendente v2, Capo servizio, Direttore v2):
// ora grande (o tempo in servizio), un solo pulsante nero o bordato, stato
// del GPS sotto; la foto compare solo quando il GPS non basta.
export function BloccoTimbratura({ now, checkIn, sotto, loading, geoStatus, onTimbra, gpsFailed, errore, onFoto, variante = 'grande', onSimula, distanza }: BloccoTimbraturaProps) {
  const inServizio = !!checkIn
  const sec = checkIn ? Math.max(0, Math.floor((now.getTime() - new Date(checkIn).getTime()) / 1000)) : 0
  const verifica = geoStatus === 'checking'
  const etichetta = verifica ? 'Verifica posizione…' : loading ? 'Invio in corso…' : inServizio ? (variante === 'compatta' ? 'Uscita' : 'Timbra uscita') : (variante === 'compatta' ? 'Timbra' : 'Timbra ingresso')

  // Grande (Dipendente v2, Capo servizio): 64 px a tutta larghezza, 18 px.
  // Compatta (Direttore v2): 60 px, padding 0 26, 17 px, icona 20.
  const pulsante = (
    <button
      type="button"
      onClick={onTimbra}
      disabled={loading || verifica}
      className={cn(
        'flex flex-none items-center justify-center font-semibold transition-transform active:scale-[0.98] disabled:opacity-60',
        variante === 'compatta' ? 'h-[60px] gap-2 whitespace-nowrap rounded-[8px] px-[26px] text-[17px]' : 'h-16 gap-2.5 rounded-[8px] text-lg',
        inServizio ? 'border-[1.5px] border-primary bg-card text-foreground' : 'bg-primary text-primary-foreground'
      )}
    >
      <svg width={variante === 'compatta' ? 20 : 22} height={variante === 'compatta' ? 20 : 22} viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d={inServizio ? ICONA_USCITA : ICONA_INGRESSO} /></svg>
      {etichetta}
    </button>
  )

  const foto = gpsFailed && (
    <div className="anim-swapin flex flex-col gap-1.5">
      {errore && <p className="text-center text-sm font-medium text-neg">{errore}</p>}
      <label className={cn('flex h-12 cursor-pointer items-center justify-center gap-2.5 rounded-[8px] border border-line-strong bg-card text-[15px] font-semibold active:scale-[0.98]', loading && 'pointer-events-none opacity-50')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        Timbra con foto
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFoto} disabled={loading} />
      </label>
      <p className="text-center text-xs text-muted-foreground">La timbratura sarà confermata dal manager</p>
    </div>
  )

  if (variante === 'compatta') {
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[8px] border border-border bg-card px-4 py-[18px]">
          <div className="flex min-w-0 flex-col gap-2">
            <span suppressHydrationWarning className="whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-[1px] text-muted-foreground">
              {inServizio ? 'In servizio da' : formatInTimeZone(now, TZ, 'EEEE d MMMM', { locale: it })}
            </span>
            <span suppressHydrationWarning className="font-mono text-[40px] font-medium leading-none tracking-[-1.5px] tabular-nums">{inServizio ? durata(sec) : formatInTimeZone(now, TZ, 'HH:mm')}</span>
          </div>
          {pulsante}
        </div>
        {foto}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center gap-1.5 px-5 pt-8">
        <span suppressHydrationWarning className="font-mono text-[11px] font-medium uppercase tracking-[1px] text-muted-foreground">
          {inServizio ? 'In servizio da' : formatInTimeZone(now, TZ, 'EEEE d MMMM', { locale: it })}
        </span>
        <span suppressHydrationWarning className="font-mono text-[64px] font-medium leading-none tracking-[-2px] tabular-nums">
          {inServizio ? durata(sec) : formatInTimeZone(now, TZ, 'HH:mm')}
        </span>
        <span className="flex items-center gap-2 text-center text-[15px] text-muted-foreground">
          <style href="timbra-pulse" precedence="default">{STILE_PULSE}</style>
          <span
            className={cn('h-2 w-2 flex-none rounded-full', inServizio ? 'timbra-pulse bg-[oklch(0.55_0.1_150)]' : 'bg-line-strong')}
            style={inServizio ? { animation: 'timbra-pulse 2s ease-in-out infinite' } : undefined}
          />
          {sotto}
        </span>
      </div>
      <div className="flex flex-col gap-2.5 px-4 pt-7">
        {pulsante}
        <span className="text-center text-xs text-muted-foreground">
          {rigaGps(geoStatus, distanza)}
        </span>
        {onSimula && process.env.NODE_ENV === 'development' && (
          <button onClick={onSimula} disabled={loading} className="text-xs text-muted-foreground underline">[DEV] Simula Scansione</button>
        )}
        {foto}
      </div>
    </div>
  )
}
