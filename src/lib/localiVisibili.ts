import { cookies } from 'next/headers'

// Locali nascosti (chiusi o stagionali, restaurants.nascosto): restano con
// tutti i loro dati ma non compaiono fra i locali attivi né in "Tutti".
// Il manager li riapre UNO ALLA VOLTA dall'archivio (Ristoranti): finché
// l'archivio è aperto tutta l'app mostra solo quel locale, così i dati di
// un locale chiuso non si mescolano mai con quelli degli attivi.
//
// Vale solo per le viste del manager (elenchi su più locali). Chi è
// legato a un solo locale (direttore, capo, dipendente, cassiere) continua
// a vedere il proprio anche se è nascosto: quelle query non passano di qui.

export const COOKIE_ARCHIVIO = 'inturno.archivio'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Id del locale nascosto aperto in archivio, o null. */
export async function archivioAperto(): Promise<string | null> {
  const v = (await cookies()).get(COOKIE_ARCHIVIO)?.value
  return v && UUID.test(v) ? v : null
}

/**
 * Restringe una query su `restaurants` ai locali che il manager deve
 * vedere: quello in archivio se ce n'è uno aperto, altrimenti gli attivi.
 */
export function soloVisibili<Q>(q: Q, archivio: string | null): Q {
  // Il costruttore di query di Supabase ha tipi troppo profondi per un
  // vincolo generico (TS2589): qui basta sapere che ha `.eq`.
  const b = q as unknown as { eq(colonna: string, valore: unknown): unknown }
  return (archivio ? b.eq('id', archivio) : b.eq('nascosto', false)) as Q
}
