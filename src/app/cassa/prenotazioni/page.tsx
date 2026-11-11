import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { archivioAperto } from '@/lib/localiVisibili'
import { PrenotazioniClient } from '@/components/cassa/PrenotazioniClient'
import type { DatiParziali } from '@/lib/cassa/prenotazioniEmailProcessing'
import type { BozzaCoda } from '@/components/cassa/PrenotazioneFormDialog'

export default async function PrenotazioniPage({
  searchParams,
}: {
  searchParams: Promise<{ completa?: string }>
}) {
  const { completa: completaLogId } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (profile?.role !== 'manager' && profile?.role !== 'hostess') redirect('/cassa/chiusura')

  // Solo i locali con almeno un'insegna configurata hanno un libro
  // visite collegato: mostrare gli altri nel selettore significherebbe
  // offrire un'agenda che non potrà mai riempirsi.
  const { data: insegne } = await supabase
    .from('prenotazioni_insegne')
    .select('id, restaurant_id, codice, etichetta, restaurants(id, name, nascosto)')
    .order('codice')

  // Il manager vede i locali attivi, o il solo locale aperto in archivio;
  // l'hostess è legata al proprio locale e lo vede anche se nascosto.
  const archivio = profile.role === 'manager' ? await archivioAperto() : null
  const perLocale = new Map<string, { id: string; name: string }>()
  for (const i of insegne ?? []) {
    const r = i.restaurants as unknown as { id: string; name: string; nascosto: boolean | null } | null
    if (!r) continue
    if (profile.role === 'manager' && (archivio ? r.id !== archivio : r.nascosto === true)) continue
    perLocale.set(r.id, { id: r.id, name: r.name })
  }

  // Il link della notifica push per una prenotazione in coda porta qui
  // con ?completa=<id log>: risolverlo già lato server (nella stessa
  // richiesta che carica la pagina, non in una chiamata a parte dopo
  // l'idratazione) è ciò che fa aprire subito la scheda invece di restare
  // ferma mentre il client va a cercarla — specialmente sentito aprendo
  // l'app da fredda da una notifica.
  let bozzaIniziale: BozzaCoda | null = null
  if (completaLogId) {
    const { data: log } = await supabase
      .from('prenotazioni_email_log')
      .select('id, payload')
      .eq('id', completaLogId)
      .eq('esito', 'incompleta')
      .maybeSingle()
    const parziale = (log?.payload as { parziale?: DatiParziali | null } | null)?.parziale
    // Una voce in coda di un locale non visibile non apre nessuna scheda.
    if (log && parziale && perLocale.has(parziale.restaurant_id)) bozzaIniziale = { ...parziale, logId: log.id }
  }

  return (
    <PrenotazioniClient
      restaurants={[...perLocale.values()].sort((a, b) => a.name.localeCompare(b.name))}
      insegne={(insegne ?? []).filter(i => perLocale.has(i.restaurant_id)).map(i => ({
        id: i.id,
        restaurant_id: i.restaurant_id,
        codice: i.codice,
        etichetta: i.etichetta,
      }))}
      bozzaIniziale={bozzaIniziale}
      currentUser={{ fullName: profile.full_name, role: profile.role }}
    />
  )
}
