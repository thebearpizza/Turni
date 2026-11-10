// Mappa di navigazione del design Acciaio, per ruolo: aree nella barra in
// basso, sezioni nei segmenti in alto, titolo e sottotitolo
// dell'intestazione (Manager/Direttore Smartphone e Tablet, Dipendente v2,
// Capo Servizio, Chiusura Tablet v2). Le rotte sono quelle esistenti: il
// design cambia come ci si arriva, non dove stanno le pagine.

export type Ruolo = 'manager' | 'direttore' | 'capo_servizio' | 'dipendente' | 'cassiere' | 'hostess' | 'consulente_lavoro'

export type IconaChiave = 'home' | 'turni' | 'ods' | 'bacheca' | 'nessuna'

export interface Sezione {
  key: string
  label: string
  href: string
  /** Prefissi di percorso che appartengono a questa sezione (il primo è href). */
  match?: string[]
  titolo: string
  /** Sottotitolo sul telefono. Segnaposti: `{locale}` (nome del locale),
   *  `{settimana}` ("Settimana 9–15 novembre"), `{mese}` ("Novembre 2026"),
   *  `{meseSolo}` ("Novembre"), `{oggi}` ("Martedì 10 novembre"). La pagina
   *  può sempre sostituirlo con impostaSottotitolo. */
  sottotitolo?: string
  /** Sottotitolo sul tablet, quando il prototipo tablet ne usa uno più lungo. */
  sottotitoloTablet?: string
  /** Chiave del contatore da mostrare come badge (vedi useContatori). */
  badge?: string
  /** La pagina ha un titolo grande suo: niente intestazione del guscio. */
  senzaIntestazione?: boolean
  /** Rotta raggiungibile (link delle notifiche, vecchi segnalibri) ma
   *  non mostrata nei segmenti: nel design la sezione non c'è più. */
  nascosta?: boolean
  /** Solo per il proprietario della piattaforma (account in attesa). */
  soloProprietario?: boolean
}

export interface Area {
  key: string
  label: string
  icona: IconaChiave
  /** Destinazione quando si tocca l'area nella barra (se non se ne ricorda un'altra). */
  href: string
  sezioni: Sezione[]
  /** Toccando l'area si torna sempre alla prima sezione (Altro → Bacheca nel design). */
  sempreDallaPrima?: boolean
}

export interface ConfigRuolo {
  /**
   * pillola: dock flottante di testo (manager, direttore, hostess, consulente);
   * schede: barra con icone Phosphor (dipendente, capo servizio);
   * cassa: dock flottante sul telefono, barra a due schede con indicatore
   * e "Esci · Nome" in alto sul tablet (Chiusura Tablet v2).
   */
  stile: 'pillola' | 'schede' | 'cassa'
  aree: Area[]
  /** L'intestazione mostra il locale e il ruolo invece del titolo di sezione. */
  intestazioneLocale?: boolean
  /** Pulsante dell'assistente AI nell'intestazione. */
  assistente?: boolean
  /** Profilo a pannello (QR del locale, PDF, XML) o a tendina (nome, Esci). */
  profilo: 'pannello' | 'tendina'
  /** In Home il titolo è "Ciao, Nome" con data e locali. */
  saluto?: boolean
}

const S = (key: string, label: string, href: string, titolo: string, sottotitolo?: string, extra: Partial<Sezione> = {}): Sezione =>
  ({ key, label, href, titolo, sottotitolo, ...extra })

const TURNI = S('turni', 'Turni', '/turni', 'Turni', '{settimana}')
const PRESENZE = S('presenze', 'Presenze', '/presenze', 'Presenze', '{mese}')
const ASSENZE = S('assenze', 'Assenze', '/assenze', 'Assenze', 'Richieste e approvate', { sottotitoloTablet: 'Richieste e assenze approvate', badge: 'assenze' })
const REPORT = S('report', 'Report', '/report', 'Report', 'Presenze e ore del mese')

const CASSA_MANAGER: Sezione[] = [
  S('analisi', 'Analisi', '/cassa/analisi', 'Analisi', 'Incassi, spese e differenze', { sottotitoloTablet: 'Incassi, spese e differenze dei locali' }),
  S('chiusure', 'Chiusure', '/cassa/lista-chiusure', 'Chiusure', 'Chiusure di cassa inviate', { match: ['/cassa/lista-chiusure', '/cassa/chiusura'] }),
  S('approvazioni', 'Approvazioni', '/cassa/approvazioni', 'Approvazioni', 'Modifiche in revisione', { sottotitoloTablet: 'Modifiche a chiusure in revisione', badge: 'modifiche' }),
  S('buste', 'Buste', '/cassa/progressivo-buste', 'Buste', 'Progressivo versamenti', { sottotitoloTablet: 'Progressivo buste versamento' }),
]

const ACQUISTI: Sezione[] = [
  S('fatture', 'Fatture', '/acquisti/fatture', 'Fatture', 'Fatture fornitori caricate', { badge: 'fatture' }),
  S('fornitori', 'Fornitori', '/acquisti/fornitori', 'Fornitori', 'Anagrafica e spesa', { sottotitoloTablet: 'Anagrafica e spesa per fornitore' }),
  S('articoli', 'Articoli', '/acquisti/articoli', 'Articoli', 'Catalogo e prezzi', { sottotitoloTablet: 'Catalogo e andamento prezzi' }),
  S('inventario', 'Inventario', '/acquisti/inventario', 'Inventario', 'Giacenze di magazzino'),
]

const ALTRO_MANAGER: Sezione[] = [
  S('bacheca', 'Bacheca', '/bacheca', 'Bacheca', 'Comunicati ai dipendenti'),
  S('ods', 'ODS', '/ods', 'ODS', 'Ordini di servizio', { badge: 'ods' }),
  S('dipendenti', 'Dipendenti', '/dipendenti', 'Dipendenti', 'Staff dei locali'),
  S('ristoranti', 'Ristoranti', '/ristoranti', 'Ristoranti', 'Locali, QR e fasce orarie'),
  // Fuori dal design ma ancora raggiungibili (link delle notifiche, account
  // da approvare del proprietario della piattaforma).
  S('account', 'Account', '/account-pendenti', 'Account in attesa', 'Nuovi manager da approvare', { badge: 'account', soloProprietario: true }),
  // Prenotazioni resta tra le schede di Altro per scelta del gestore, anche
  // se il design non la prevede.
  S('prenotazioni', 'Prenotazioni', '/cassa/prenotazioni', 'Prenotazioni', 'Agenda del servizio'),
  S('timbrature', 'Approvazioni', '/approvazioni', 'Approvazioni', 'Timbrature con foto e richieste', { nascosta: true }),
  S('dashboard', 'Riepilogo', '/dashboard', 'Riepilogo', 'Presenze di oggi', { nascosta: true }),
]

export const NAVIGAZIONE: Record<Ruolo, ConfigRuolo> = {
  manager: {
    stile: 'pillola',
    assistente: true,
    profilo: 'pannello',
    saluto: true,
    aree: [
      { key: 'home', label: 'Home', icona: 'home', href: '/hub', sezioni: [S('home', 'Home', '/hub', 'Home', undefined, { match: ['/hub'] })] },
      { key: 'turni', label: 'Turni', icona: 'turni', href: '/turni', sezioni: [TURNI, PRESENZE, ASSENZE, REPORT] },
      { key: 'cassa', label: 'Cassa', icona: 'nessuna', href: '/cassa/analisi', sezioni: CASSA_MANAGER },
      { key: 'acquisti', label: 'Acquisti', icona: 'nessuna', href: '/acquisti/fatture', sezioni: ACQUISTI },
      { key: 'altro', label: 'Altro', icona: 'nessuna', href: '/bacheca', sezioni: ALTRO_MANAGER, sempreDallaPrima: true },
    ],
  },
  // Direttore Smartphone e Direttore Tablet v2: stesse sezioni del manager
  // su un solo locale (niente Cassa, Report come area).
  direttore: {
    stile: 'pillola',
    assistente: true,
    profilo: 'pannello',
    saluto: true,
    aree: [
      { key: 'home', label: 'Home', icona: 'home', href: '/dashboard', sezioni: [S('home', 'Home', '/dashboard', 'Home', undefined, { match: ['/dashboard', '/hub', '/approvazioni'] })] },
      { key: 'turni', label: 'Turni', icona: 'turni', href: '/turni', sezioni: [TURNI, ASSENZE] },
      { key: 'report', label: 'Report', icona: 'nessuna', href: '/report', sezioni: [REPORT] },
      { key: 'acquisti', label: 'Acquisti', icona: 'nessuna', href: '/acquisti/fatture', sezioni: ACQUISTI },
      {
        key: 'altro', label: 'Altro', icona: 'nessuna', href: '/bacheca', sempreDallaPrima: true, sezioni: [
          S('bacheca', 'Bacheca', '/bacheca', 'Bacheca', 'Comunicati ai dipendenti'),
          S('ods', 'ODS', '/ods', 'ODS', 'Ordini di servizio', { badge: 'ods' }),
          S('dipendenti', 'Dipendenti', '/dipendenti', 'Dipendenti', 'Staff di {locale}'),
        ],
      },
    ],
  },
  capo_servizio: {
    stile: 'schede',
    intestazioneLocale: true,
    profilo: 'tendina',
    aree: [
      { key: 'home', label: 'Home', icona: 'home', href: '/dashboard', sezioni: [S('home', 'Home', '/dashboard', 'Home', undefined, { match: ['/dashboard', '/hub'] })] },
      { key: 'bacheca', label: 'Bacheca', icona: 'bacheca', href: '/bacheca', sezioni: [S('bacheca', 'Bacheca', '/bacheca', 'Bacheca', undefined, { badge: 'bacheca' })] },
      { key: 'turni', label: 'Turni', icona: 'turni', href: '/turni', sezioni: [S('turni', 'Turni', '/turni', 'Turni', undefined, { match: ['/turni', '/report'] })] },
      { key: 'ods', label: 'ODS', icona: 'ods', href: '/ods', sezioni: [S('ods', 'ODS', '/ods', 'ODS', undefined, { badge: 'ods' })] },
    ],
  },
  dipendente: {
    stile: 'schede',
    intestazioneLocale: true,
    profilo: 'tendina',
    aree: [
      { key: 'home', label: 'Home', icona: 'home', href: '/home', sezioni: [S('home', 'Home', '/home', 'Home', undefined, { match: ['/home'] })] },
      { key: 'ods', label: 'ODS', icona: 'ods', href: '/home/ods', sezioni: [S('ods', 'ODS', '/home/ods', 'Ordini di servizio', undefined, { badge: 'ods', senzaIntestazione: true })] },
      { key: 'turni', label: 'Turni', icona: 'turni', href: '/home/miei-turni', sezioni: [S('turni', 'Turni', '/home/miei-turni', 'I miei turni', undefined, { senzaIntestazione: true })] },
    ],
  },
  cassiere: {
    stile: 'cassa',
    profilo: 'tendina',
    aree: [
      { key: 'chiusura', label: 'Chiusura', icona: 'nessuna', href: '/cassa/chiusura', sezioni: [S('chiusura', 'Chiusura', '/cassa/chiusura', 'Chiusura cassa', '{oggi}')] },
      { key: 'lista', label: 'Lista chiusure', icona: 'nessuna', href: '/cassa/lista-chiusure', sezioni: [S('lista', 'Lista chiusure', '/cassa/lista-chiusure', 'Lista chiusure', '{meseSolo}')] },
    ],
  },
  hostess: {
    stile: 'pillola',
    profilo: 'tendina',
    aree: [
      { key: 'prenotazioni', label: 'Prenotazioni', icona: 'nessuna', href: '/cassa/prenotazioni', sezioni: [S('prenotazioni', 'Prenotazioni', '/cassa/prenotazioni', 'Prenotazioni', 'Agenda del servizio')] },
    ],
  },
  consulente_lavoro: {
    stile: 'pillola',
    profilo: 'tendina',
    aree: [
      { key: 'report', label: 'Report', icona: 'nessuna', href: '/consulente/dashboard', sezioni: [S('report', 'Report', '/consulente/dashboard', 'Report', 'Presenze e ore dei locali')] },
    ],
  },
}

function corrisponde(pathname: string, s: Sezione): number {
  const prefissi = s.match ?? [s.href]
  let migliore = -1
  for (const p of prefissi) {
    if (pathname === p || pathname.startsWith(p + '/')) migliore = Math.max(migliore, p.length)
  }
  return migliore
}

/** Area e sezione correnti: vince il prefisso più lungo. */
export function trovaPosizione(cfg: ConfigRuolo, pathname: string): { area: Area | null; sezione: Sezione | null } {
  let best: { area: Area | null; sezione: Sezione | null; len: number } = { area: null, sezione: null, len: -1 }
  for (const area of cfg.aree) {
    for (const s of area.sezioni) {
      const l = corrisponde(pathname, s)
      if (l > best.len) best = { area, sezione: s, len: l }
    }
  }
  return { area: best.area, sezione: best.sezione }
}

/** Sezioni mostrate nei segmenti in alto. */
export function sezioniVisibili(area: Area | null, isPlatformOwner: boolean): Sezione[] {
  if (!area) return []
  return area.sezioni.filter(s => !s.nascosta && (!s.soloProprietario || isPlatformOwner))
}
