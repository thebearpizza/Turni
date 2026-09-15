import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { autoCloseStaleShifts } from '@/lib/autoCloseStaleShifts'
import { HubTopBar } from '@/components/manager/HubTopBar'
import { HubAreaCard, HubAreaCardSkeleton, type HubIndicatore } from '@/components/manager/HubAreaCard'
import { CalendarClock, Wallet, Truck } from 'lucide-react'

const TZ = 'Europe/Rome'

function saluto(ora: number): string {
  if (ora < 12) return 'Buongiorno'
  if (ora < 18) return 'Buon pomeriggio'
  return 'Buonasera'
}

// Confini di oggi/ieri/mese in fuso Europe/Rome, calcolati da un istante
// UTC fisso (stesso trucco già in uso in ChiusuraCassaClient/
// dataChiusuraDiDefault): sottrarre 24h in millisecondi a "adesso" e poi
// leggere la data risultante nel fuso voluto è corretto anche a cavallo
// del cambio ora legale, senza dover ragionare in timezone lato SQL.
function confiniOggi() {
  const oraUTC = new Date()
  const oggi = formatInTimeZone(oraUTC, TZ, 'yyyy-MM-dd')
  const ieri = formatInTimeZone(new Date(oraUTC.getTime() - 24 * 60 * 60 * 1000), TZ, 'yyyy-MM-dd')
  const oggiInizioUtc = fromZonedTime(`${oggi}T00:00:00`, TZ).toISOString()
  const mese = oggi.slice(0, 7)
  const ieriMese = ieri.slice(0, 7)
  const giorniTrascorsi = ieriMese === mese ? Number(ieri.slice(8, 10)) : 0
  const [anno, meseNum] = mese.split('-').map(Number)
  const ultimoGiorno = new Date(anno, meseNum, 0).getDate()
  return {
    oggi,
    ieri,
    oggiInizioUtc,
    meseInizio: `${mese}-01`,
    meseFine: `${mese}-${String(ultimoGiorno).padStart(2, '0')}`,
    giorniTrascorsi,
  }
}

export default async function HubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (!profile || profile.role !== 'manager') redirect('/dashboard')

  const ora = Number(formatInTimeZone(new Date(), TZ, 'H'))
  const dataLabelGrezza = formatInTimeZone(new Date(), TZ, 'EEEE d MMMM', { locale: it })
  const dataLabel = dataLabelGrezza.charAt(0).toUpperCase() + dataLabelGrezza.slice(1)
  const primoNome = profile.full_name?.split(' ')[0] ?? ''

  return (
    <div className="min-h-[100dvh] bg-background">
      <HubTopBar />
      <div className="mx-auto max-w-3xl px-6 pb-10 pt-6 lg:px-10">
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">{saluto(ora)}, {primoNome}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Dove lavoriamo?</h1>
          <p className="mt-1 text-sm text-muted-foreground">{dataLabel}</p>
        </div>

        <div className="space-y-3">
          <Suspense fallback={<HubAreaCardSkeleton />}>
            <TurniCard />
          </Suspense>
          <Suspense fallback={<HubAreaCardSkeleton />}>
            <CassaCard />
          </Suspense>
          <Suspense fallback={<HubAreaCardSkeleton />}>
            <AcquistiCard />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

// Ogni card è un componente server async indipendente, montato dentro il
// proprio <Suspense>: se una query è lenta, la Home mostra subito lo
// scheletro di QUELLA card e le altre due nel frattempo, invece di
// aspettare tutte prima di mostrare qualunque cosa. Se una query fallisce
// del tutto, il try/catch lascia i valori di default '—' — la card resta
// comunque cliccabile.

async function TurniCard() {
  let indicatori: HubIndicatore[] = [
    { label: 'Presenti ora', value: '—' },
    { label: 'Da approvare', value: '—' },
    { label: 'Assenze oggi', value: '—' },
  ]
  try {
    const supabase = await createClient()
    const { oggi, oggiInizioUtc } = confiniOggi()
    // Chiude le timbrature con uscita dimenticata prima di contare i
    // presenti, stesso motivo di dashboard/page.tsx: altrimenti "presenti
    // ora" resta gonfiato da turni mai chiusi.
    await autoCloseStaleShifts(createAdminClient())
    const { data: raw, error } = await supabase
      .rpc('hub_indicatori_turni', { p_oggi: oggi, p_oggi_inizio_utc: oggiInizioUtc })
      .single()
    if (error || !raw) throw error ?? new Error('nessun dato')
    const data = raw as { presenti_ora: number; richieste_da_approvare: number; assenze_oggi: number }
    const richieste = Number(data.richieste_da_approvare)
    indicatori = [
      { label: 'Presenti ora', value: String(data.presenti_ora) },
      { label: 'Da approvare', value: String(richieste), alert: richieste > 0 },
      { label: 'Assenze oggi', value: String(data.assenze_oggi) },
    ]
  } catch {
    // indicatori resta ai valori di default '—'
  }
  return (
    <HubAreaCard
      href="/dashboard"
      tone="#7C9BFF"
      icon={CalendarClock}
      title="Turni"
      description="Turni, presenze e dipendenti"
      indicatori={indicatori}
    />
  )
}

async function CassaCard() {
  let indicatori: HubIndicatore[] = [
    { label: 'Mese', value: '—' },
    { label: 'Mancanti', value: '—' },
    { label: 'Differenza', value: '—' },
  ]
  try {
    const supabase = await createClient()
    const { ieri, meseInizio, meseFine, giorniTrascorsi } = confiniOggi()
    const { data: raw, error } = await supabase
      .rpc('hub_indicatori_cassa', { p_mese_inizio: meseInizio, p_mese_fine: meseFine, p_ieri: ieri, p_giorni_trascorsi: giorniTrascorsi })
      .single()
    if (error || !raw) throw error ?? new Error('nessun dato')
    const data = raw as { totale_entrate_mese: number; chiusure_mancanti: number; differenza_mese: number }
    const mancanti = Number(data.chiusure_mancanti)
    indicatori = [
      { label: 'Mese', value: `€ ${Number(data.totale_entrate_mese).toFixed(2)}` },
      { label: 'Mancanti', value: String(mancanti), alert: mancanti > 0 },
      { label: 'Differenza', value: `€ ${Number(data.differenza_mese).toFixed(2)}` },
    ]
  } catch {
    // indicatori resta ai valori di default '—'
  }
  return (
    <HubAreaCard
      href="/cassa"
      tone="#68D9A8"
      icon={Wallet}
      title="Cassa"
      description="Chiusure e analisi incassi"
      indicatori={indicatori}
    />
  )
}

async function AcquistiCard() {
  let indicatori: HubIndicatore[] = [
    { label: 'Fatture mese', value: '—' },
    { label: 'Da verificare', value: '—' },
    { label: 'Spesa merce', value: '—' },
  ]
  try {
    const supabase = await createClient()
    const { meseInizio, meseFine } = confiniOggi()
    const { data: raw, error } = await supabase
      .rpc('hub_indicatori_acquisti', { p_mese_inizio: meseInizio, p_mese_fine: meseFine })
      .single()
    if (error || !raw) throw error ?? new Error('nessun dato')
    const data = raw as { fatture_mese: number; fatture_da_verificare: number; spesa_merce_mese: number }
    const daVerificare = Number(data.fatture_da_verificare)
    indicatori = [
      { label: 'Fatture mese', value: String(data.fatture_mese) },
      { label: 'Da verificare', value: String(daVerificare), alert: daVerificare > 0 },
      { label: 'Spesa merce', value: `€ ${Number(data.spesa_merce_mese).toFixed(2)}` },
    ]
  } catch {
    // indicatori resta ai valori di default '—'
  }
  return (
    <HubAreaCard
      href="/acquisti/fatture"
      tone="#E0A85C"
      icon={Truck}
      title="Acquisti"
      description="Fatture, articoli e fornitori"
      indicatori={indicatori}
    />
  )
}
