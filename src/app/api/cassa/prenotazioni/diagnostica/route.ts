import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cercaMessaggi, leggiMessaggio, profiloGmail, gmailConfigurato } from '@/lib/gmail'
import { aiConfigurata } from '@/lib/cassa/prenotazioniParsing'
import { queryMittenti, GIORNI_FINESTRA } from '@/lib/cassa/prenotazioniMail'

// Risponde alla domanda "la casella è collegata e l'app la legge?" con
// dei fatti invece che con una supposizione: prova davvero a collegarsi,
// dice QUALE casella sta leggendo e mostra le ultime mail che ha visto
// dai due gestionali.
//
// Serve perché il modo in cui questa integrazione fallisce è silenzioso:
// credenziali mancanti, credenziali emesse per l'account sbagliato,
// notifiche che il gestionale non manda affatto — tutti e tre danno lo
// stesso risultato a schermo (agenda vuota) e nessun errore visibile.
export const maxDuration = 30

// Quante mail mostrare come prova. Poche: servono a riconoscere cosa
// arriva davvero, non a leggere la posta dall'app.
const ANTEPRIME = 5

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminClient()

  // Stato del registro: quante mail sono state effettivamente lavorate
  // finora. Zero righe qui significa che la sincronizzazione non è mai
  // partita, indipendentemente da tutto il resto.
  const [{ count: mailLavorate }, { data: ultimeLavorate }, { count: daMail }] = await Promise.all([
    admin.from('prenotazioni_email_log').select('*', { count: 'exact', head: true }),
    admin.from('prenotazioni_email_log')
      .select('oggetto, mittente, esito, evento, errore, created_at')
      .order('created_at', { ascending: false })
      .limit(ANTEPRIME),
    admin.from('prenotazioni').select('*', { count: 'exact', head: true }).in('origine', ['thefork', 'restoo']),
  ])

  const configurazione = {
    gmail:      gmailConfigurato(),
    ai:         aiConfigurata(),
    // Senza questo lo scheduler non può invocare la sincronizzazione:
    // l'endpoint rifiuta la chiamata prima di fare qualsiasi altra cosa.
    cronSecret: !!process.env.CRON_SECRET,
  }

  // Se le credenziali non ci sono non ha senso tentare il collegamento:
  // si risponde con quello che si sa già.
  if (!configurazione.gmail) {
    return NextResponse.json({
      configurazione,
      collegamento: { ok: false, motivo: 'Credenziali Gmail non configurate sul server' },
      registro: {
        mailLavorate: mailLavorate ?? 0,
        prenotazioniDaMail: daMail ?? 0,
        ultime: ultimeLavorate ?? [],
      },
    })
  }

  // Collegamento reale: prima chi siamo (quale casella), poi cosa si
  // vede con la stessa identica query della sincronizzazione.
  let collegamento: {
    ok: boolean
    casella?: string
    motivo?: string
    trovate?: number
    finestraGiorni?: number
    anteprime?: Array<{ mittente: string; oggetto: string; ricevutaAt: string | null }>
  }

  try {
    const profilo = await profiloGmail()
    const ids = await cercaMessaggi(queryMittenti(), ANTEPRIME)
    const anteprime = await Promise.all(
      ids.slice(0, ANTEPRIME).map(async id => {
        const m = await leggiMessaggio(id)
        return { mittente: m.mittente, oggetto: m.oggetto, ricevutaAt: m.ricevutaAt }
      })
    )
    collegamento = {
      ok: true,
      casella: profilo.emailAddress,
      trovate: ids.length,
      finestraGiorni: GIORNI_FINESTRA,
      anteprime,
    }
  } catch (err) {
    collegamento = {
      ok: false,
      motivo: err instanceof Error ? err.message : 'Collegamento a Gmail non riuscito',
    }
  }

  return NextResponse.json({
    configurazione,
    collegamento,
    registro: {
      mailLavorate: mailLavorate ?? 0,
      prenotazioniDaMail: daMail ?? 0,
      ultime: ultimeLavorate ?? [],
    },
  })
}
