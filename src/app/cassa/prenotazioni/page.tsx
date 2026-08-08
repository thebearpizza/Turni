import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
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

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore').eq('id', user.id).single()
  if (profile?.role === 'capo_servizio' && profile.is_direttore) redirect('/cassa/fatture')
  if (profile?.role !== 'manager' && profile?.role !== 'hostess') redirect('/cassa/chiusura')

  // Solo i locali con almeno un'insegna configurata hanno un libro
  // visite collegato: mostrare gli altri nel selettore significherebbe
  // offrire un'agenda che non potrà mai riempirsi.
  const { data: insegne } = await supabase
    .from('prenotazioni_insegne')
    .select('id, restaurant_id, codice, etichetta, restaurants(id, name)')
    .order('codice')

  const perLocale = new Map<string, { id: string; name: string }>()
  for (const i of insegne ?? []) {
    const r = i.restaurants as unknown as { id: string; name: string } | null
    if (r) perLocale.set(r.id, r)
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
    if (log && parziale) bozzaIniziale = { ...parziale, logId: log.id }
  }

  return (
    <PrenotazioniClient
      restaurants={[...perLocale.values()].sort((a, b) => a.name.localeCompare(b.name))}
      insegne={(insegne ?? []).map(i => ({
        id: i.id,
        restaurant_id: i.restaurant_id,
        codice: i.codice,
        etichetta: i.etichetta,
      }))}
      bozzaIniziale={bozzaIniziale}
    />
  )
}
