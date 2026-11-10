'use client'
import { useEffect, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { approveAccount, rejectAccount } from '@/app/actions/adminActions'
import { toast } from '@/hooks/use-toast'
import { chiediConferma } from '@/components/shared/Conferma'
import { BarraAltro, ElencoAltro, PannelloDettaglio, GrigliaAltro, GRIGIO_TUTTI, USCITA, type RigaAltro, type DatiDettaglio } from '@/components/altro/comuni'

// Account in attesa (registrazioni di nuovi manager, solo per il
// proprietario della piattaforma). Il design non ha una schermata dedicata:
// segue lo schema delle schede di Altro (MTAltro) — elenco a sinistra,
// dettaglio con Rifiuta / Approva a destra, foglio dal basso sul telefono.

interface PendingAccount { id: string; full_name: string; username: string | null; created_at: string }

const TZ = 'Europe/Rome'
const MESI3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const quando = (iso: string, oggi: string) => {
  const g = formatInTimeZone(new Date(iso), TZ, 'yyyy-MM-dd')
  if (g === oggi) return 'oggi ' + formatInTimeZone(new Date(iso), TZ, 'H:mm')
  const [, m, d] = g.split('-').map(Number)
  return `${d} ${MESI3[m - 1]}`
}

export function AccountPendentiClient({ initialAccounts }: { initialAccounts: PendingAccount[] }) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [oggi] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
  const [sel, setSel] = useState<string | null>(null)
  const [esce, setEsce] = useState(false)
  const [occupato, setOccupato] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (t.current) clearTimeout(t.current) }, [])

  const chiudi = () => { setEsce(true); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => { setSel(null); setEsce(false) }, USCITA) }

  async function decidi(a: PendingAccount, ok: boolean) {
    if (!ok && !(await chiediConferma({ titolo: `Rifiutare ${a.full_name}?`, testo: "L'account e i suoi dati demo vengono eliminati.", conferma: 'Rifiuta' }))) return
    setOccupato(true)
    try {
      await (ok ? approveAccount(a.id) : rejectAccount(a.id))
      setAccounts(x => x.filter(y => y.id !== a.id))
      setSel(null)
      toast({ title: ok ? `Account di ${a.full_name} attivato` : 'Richiesta rifiutata' })
    } catch (e) {
      toast({ title: ok ? 'Approvazione non riuscita' : 'Rifiuto non riuscito', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setOccupato(false)
    }
  }

  const righe: RigaAltro[] = accounts.map(a => ({ key: a.id, a: a.full_name, as: a.username ?? '—', lc: GRIGIO_TUTTI, b: '', c: quando(a.created_at, oggi), t: 'In attesa', tono: 'warn' }))
  const a = accounts.find(x => x.id === sel)
  const d: DatiDettaglio | null = a ? {
    titolo: a.full_name, sotto: 'Manager · registrato ' + quando(a.created_at, oggi), tag: 'In attesa', tono: 'warn',
    msg: 'Finché non lo approvi vede i dati demo in sola lettura. Approvando, i dati demo vengono cancellati e crea lui il suo primo locale.',
    sezioni: [{ h: 'Account', righe: [{ l: 'Username', v: a.username ?? '—' }, { l: 'Richiesta del', v: formatInTimeZone(new Date(a.created_at), TZ, 'dd/MM/yyyy HH:mm') }] }],
    azioni: [
      { l: 'Rifiuta', stile: 'neg', onClick: () => decidi(a, false), disabilitata: occupato },
      { l: 'Approva', stile: 'nero', onClick: () => decidi(a, true), disabilitata: occupato },
    ],
  } : null

  return (
    <div className="relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <BarraAltro kpis={[{ l: 'In attesa', v: String(accounts.length) }]} />
      <GrigliaAltro>
        <ElencoAltro
          testate={[{ l: 'Richiesta', a: 'left' }, { l: '', a: 'right' }, { l: 'Inviata', a: 'right' }, { l: 'Stato', a: 'right' }]}
          colonne="minmax(0,1.4fr) 0px 110px 110px" righe={righe} scelta={sel} onScegli={k => { if (t.current) clearTimeout(t.current); setEsce(false); setSel(k) }}
          vuoto={{ t: 'Nessuna richiesta in attesa', s: 'Le nuove registrazioni di manager compaiono qui.' }}
        />
        <PannelloDettaglio d={d} chiave={`acc|${sel}`} esce={esce} onChiudi={chiudi} />
      </GrigliaAltro>
    </div>
  )
}
