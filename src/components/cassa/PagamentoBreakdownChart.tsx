'use client'
import { useMemo } from 'react'
import { SchedaAnalisi, COLORI_PAGAMENTO } from '@/components/cassa/SchedaAnalisi'
import { eur2 } from '@/lib/utils'

interface EntrateRow {
  data: string
  restaurant_id: string
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
  incasso_asporto: number
  coperti: number
}

const TIPI = [
  { nome: 'POS', key: 'entrate_pos', colore: COLORI_PAGAMENTO.pos },
  { nome: 'Contanti', key: 'entrate_contanti', colore: COLORI_PAGAMENTO.contanti },
  { nome: 'Bonifico', key: 'entrate_bonifico', colore: COLORI_PAGAMENTO.bonifico },
] as const

const pct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`

// "Pagamenti" del design: una barra orizzontale divisa per tipo, sotto le
// righe con importo e quota; in fondo asporto e coperti medi al giorno.
export function PagamentoBreakdownChart({ righe }: { righe: EntrateRow[] }) {
  const { voci, totale, asporto, copertiGiorno } = useMemo(() => {
    const voci = TIPI.map(t => ({ ...t, totale: righe.reduce((s, r) => s + (r[t.key] ?? 0), 0) }))
    const totale = voci.reduce((s, v) => s + v.totale, 0)
    const giorni = new Set(righe.map(r => r.data)).size
    return {
      voci,
      totale,
      asporto: righe.reduce((s, r) => s + (r.incasso_asporto ?? 0), 0),
      copertiGiorno: giorni ? Math.round(righe.reduce((s, r) => s + (r.coperti ?? 0), 0) / giorni) : 0,
    }
  }, [righe])

  return (
    <SchedaAnalisi titolo="Pagamenti" ritardo={120}>
      {totale <= 0 ? (
        <p className="text-sm text-muted-foreground">Nessuna entrata registrata nel periodo.</p>
      ) : (
        <>
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full">
            {voci.filter(v => v.totale > 0).map(v => (
              <div key={v.nome} style={{ width: `${(v.totale / totale) * 100}%`, background: v.colore, transition: 'width 600ms cubic-bezier(0.22,1,0.36,1)' }} />
            ))}
          </div>
          <div className="flex flex-col">
            {voci.map(v => (
              <div key={v.nome} className="flex items-center gap-3 py-2.5">
                <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: v.colore }} />
                <span className="flex-1 text-[15px]">{v.nome}</span>
                <span className="whitespace-nowrap font-mono text-[14px]">€ {eur2(v.totale)}</span>
                <span className="w-14 text-right font-mono text-xs text-muted-foreground">{pct((v.totale / totale) * 100)}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div className="flex flex-col"><span className="text-xs text-muted-foreground">di cui asporto</span><span className="font-mono text-[15px]">€ {eur2(asporto)}</span></div>
            <div className="flex flex-col"><span className="text-xs text-muted-foreground">Coperti medi / giorno</span><span className="font-mono text-[15px]">{copertiGiorno}</span></div>
          </div>
        </>
      )}
    </SchedaAnalisi>
  )
}
