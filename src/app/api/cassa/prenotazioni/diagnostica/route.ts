import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cercaMessaggi, leggiMessaggio, profiloGmail, gmailConfigurato } from '@/lib/gmail'
import { aiConfigurata } from '@/lib/cassa/prenotazioniParsing'
import { queryMittenti, GIORNI_FINESTRA } from '@/lib/cassa/prenotazioniMail'

// Risponde alla domanda "le prenotazioni entrano davvero?" con dei fatti
// invece che con una supposizione — su entrambe le vie d'ingresso
// possibili: il polling di una casella Gmail, o il webhook di posta in
// entrata (CloudMailin). Entrambe falliscono in silenzio nello stesso
// modo: credenziali mancanti, credenziali/indirizzo sbagliati, oppure
// notifiche che il gestionale non manda affatto — sempre la stessa
// agenda vuota, mai un errore visibile.
export const maxDuration = 30

// Quante mail mostrare come prova, per via d'ingresso. Poche: servono a
// riconoscere cosa arriva davvero, non a leggere la posta dall'app.
const ANTEPRIME = 5

type RigaLog = { oggetto: string | null; mittente: string | null; esito: string; errore: string | null; created_at: string }

async function statoCanale(admin: ReturnType<typeof createAdminClient>, origine: 'gmail' | 'cloudmailin') {
  const [{ count }, { data: ultime }] = await Promise.all([
    admin.from('prenotazioni_email_log').select('*', { count: 'exact', head: true }).eq('origine', origine),
    admin.from('prenotazioni_email_log')
      .select('oggetto, mittente, esito, errore, created_at')
      .eq('origine', origine)
      .order('created_at', { ascending: false })
      .limit(ANTEPRIME),
  ])
  return { mailLavorate: count ?? 0, ultime: (ultime ?? []) as RigaLog[] }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminClient()

  const configurazione = {
    gmail:      gmailConfigurato(),
    // Il webhook non ha credenziali da collegare come Gmail: esiste ed è
    // attivo se e solo se il segreto con cui si autentica è impostato.
    webhook:    !!process.env.PRENOTAZIONI_WEBHOOK_SECRET,
    ai:         aiConfigurata(),
    // Senza questo lo scheduler non può invocare la sincronizzazione
    // Gmail: l'endpoint rifiuta la chiamata prima di fare altro. Non
    // riguarda il webhook, che non passa dallo scheduler.
    cronSecret: !!process.env.CRON_SECRET,
  }

  const [canaleGmail, canaleWebhook] = await Promise.all([
    statoCanale(admin, 'gmail'),
    statoCanale(admin, 'cloudmailin'),
  ])

  // Prova di collegamento reale a Gmail (solo se configurato): prima chi
  // siamo — quale casella — poi cosa si vede con la stessa identica
  // query della sincronizzazione. Non c'è un equivalente per il webhook:
  // è CloudMailin che chiama noi, non il contrario, quindi qui non c'è
  // nulla da "provare a collegare" — il numero di mail già ricevute
  // (canaleWebhook.mailLavorate) è già la prova che serve.
  let gmail: {
    ok: boolean
    casella?: string
    motivo?: string
    trovate?: number
    finestraGiorni?: number
    anteprime?: Array<{ mittente: string; oggetto: string; ricevutaAt: string | null }>
  } | null = null

  if (configurazione.gmail) {
    try {
      const profilo = await profiloGmail()
      const ids = await cercaMessaggi(queryMittenti(), ANTEPRIME)
      const anteprime = await Promise.all(
        ids.slice(0, ANTEPRIME).map(async id => {
          const m = await leggiMessaggio(id)
          return { mittente: m.mittente, oggetto: m.oggetto, ricevutaAt: m.ricevutaAt }
        })
      )
      gmail = { ok: true, casella: profilo.emailAddress, trovate: ids.length, finestraGiorni: GIORNI_FINESTRA, anteprime }
    } catch (err) {
      gmail = { ok: false, motivo: err instanceof Error ? err.message : 'Collegamento a Gmail non riuscito' }
    }
  }

  return NextResponse.json({
    configurazione,
    gmail,
    canali: { gmail: canaleGmail, cloudmailin: canaleWebhook },
  })
}
