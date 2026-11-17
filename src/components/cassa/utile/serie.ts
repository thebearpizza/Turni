'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import type { ContoEconomico, Movimento } from '@/lib/utile'
import { caricaUtile, chiaveCompleto, contoMese, type DatiUtile } from './dati'

// Mesi completi dell'utile per un gruppo di locali e un intervallo:
// condiviso dal resoconto in Analisi e dal suo confronto A/B.

const TZ = 'Europe/Rome'

export interface MeseUtile { m01: string; locali: string[]; ce: ContoEconomico; mov: Movimento[] }

export function mesiTra(a: string, b: string): string[] {
  const out: string[] = []
  let [y, m] = a.slice(0, 7).split('-').map(Number)
  const fine = b.slice(0, 7)
  for (let i = 0; i < 60; i++) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    if (k > fine) break
    out.push(`${k}-01`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

const SOMMABILI = ['incassi', 'ricavi', 'food', 'beverage', 'merciContanti', 'merci', 'personaleMano', 'personaleContanti', 'personale', 'primeCost', 'materiali', 'contanti', 'costi', 'utile'] as const
export function somma(xs: ContoEconomico[]): ContoEconomico {
  const o = { operativi: [] } as unknown as ContoEconomico
  for (const k of SOMMABILI) (o as unknown as Record<string, number>)[k] = xs.reduce((t, x) => t + x[k], 0)
  return o
}

/** Mesi completi (già finiti) dei locali dati nell'intervallo a..b. */
export function useSerieUtile(ids: string[], a: string, b: string): { serie: MeseUtile[]; pronto: boolean } {
  const meseOggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  // Solo mesi già finiti: quello in corso non può essere completo.
  const mesi = useMemo(() => mesiTra(a, b).filter(m => m.slice(0, 7) < meseOggi), [a, b, meseOggi])
  const [dati, setDati] = useState<DatiUtile | null>(null)
  const [pronto, setPronto] = useState(false)
  const req = useRef(0)
  const chiave = ids.join(',')
  const carica = useCallback(async () => {
    const n = ++req.current
    const lista = chiave ? chiave.split(',') : []
    if (!mesi.length || !lista.length) { setDati(null); setPronto(true); return }
    const r = await caricaUtile(createClient(), lista, mesi[0], mesi[mesi.length - 1])
    if (n !== req.current) return
    setDati(r.errore ? null : r.dati)
    setPronto(true)
  }, [chiave, mesi])
  useEffect(() => { carica() }, [carica])

  const serie = useMemo(() => {
    if (!dati) return []
    const lista = chiave ? chiave.split(',') : []
    return mesi.flatMap(m01 => {
      const locali = lista.filter(id => dati.completi.has(chiaveCompleto(id, m01)))
      if (!locali.length) return []
      const { ce, mov } = contoMese(dati, m01, new Set(locali))
      return [{ m01, locali, ce, mov }]
    })
  }, [dati, mesi, chiave])
  return { serie, pronto }
}
