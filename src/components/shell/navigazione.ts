// Mappa di navigazione del design Acciaio, per ruolo: aree nella barra in
// basso, sezioni nei segmenti in alto, titolo e sottotitolo
// dell'intestazione. Le rotte sono quelle esistenti: il design cambia come
// ci si arriva, non dove stanno le pagine.

export type Ruolo = 'manager' | 'direttore' | 'capo_servizio' | 'dipendente' | 'cassiere' | 'hostess' | 'consulente_lavoro'

export type IconaChiave =
  | 'home' | 'turni' | 'cassa' | 'acquisti' | 'altro' | 'ods' | 'bacheca' | 'report' | 'menu'
  | 'chiusura' | 'lista' | 'prenotazioni' | 'messaggi'

export interface Sezione {
  key: string
  label: string
  href: string
  /** Prefissi di percorso che appartengono a questa sezione (il primo è href). */
  match?: string[]
  titolo: string
  sottotitolo?: string
  /** Chiave del contatore da mostrare come badge (vedi useContatori). */
  badge?: string
}

export interface Area {
  key: string
  label: string
  icona: IconaChiave
  /** Destinazione quando si tocca l'area nella barra. */
  href: string
  sezioni: Sezione[]
  /** Area-menu: non porta a una pagina, apre un foglio con le sezioni. */
  menu?: boolean
}

export interface ConfigRuolo {
  stile: 'pillola' | 'schede'
  aree: Area[]
  /** L'intestazione mostra il locale e il ruolo invece del titolo di sezione. */
  intestazioneLocale?: boolean
  /** Pulsante dell'assistente AI nell'intestazione. */
  assistente?: boolean
}

const S = (key: string, label: string, href: string, titolo: string, sottotitolo?: string, extra: Partial<Sezione> = {}): Sezione =>
  ({ key, label, href, titolo, sottotitolo, ...extra })

const TURNI_MANAGER: Sezione[] = [
  S('turni', 'Turni', '/turni', 'Turni', 'Settimana e timeline'),
  S('presenze', 'Presenze', '/presenze', 'Presenze', 'Timbrature dei locali'),
  S('assenze', 'Assenze', '/assenze', 'Assenze', 'Richieste e approvate', { match: ['/assenze', '/approvazioni'], badge: 'assenze' }),
  S('report', 'Report', '/report', 'Report', 'Presenze e ore del mese'),
]

const CASSA_MANAGER: Sezione[] = [
  S('analisi', 'Analisi', '/cassa/analisi', 'Analisi', 'Incassi, spese e differenze'),
  S('chiusure', 'Chiusure', '/cassa/lista-chiusure', 'Chiusure', 'Chiusure di cassa inviate', { match: ['/cassa/lista-chiusure', '/cassa/chiusura'] }),
  S('approvazioni', 'Approvazioni', '/cassa/approvazioni', 'Approvazioni', 'Modifiche in revisione', { badge: 'modifiche' }),
  S('buste', 'Buste', '/cassa/progressivo-buste', 'Buste', 'Progressivo versamenti'),
]

const ACQUISTI: Sezione[] = [
  S('fatture', 'Fatture', '/acquisti/fatture', 'Fatture', 'Fatture fornitori caricate', { badge: 'fatture' }),
  S('fornitori', 'Fornitori', '/acquisti/fornitori', 'Fornitori', 'Anagrafica e spesa'),
  S('articoli', 'Articoli', '/acquisti/articoli', 'Articoli', 'Catalogo e prezzi'),
  S('inventario', 'Inventario', '/acquisti/inventario', 'Inventario', 'Giacenze di magazzino'),
]

const ALTRO_MANAGER: Sezione[] = [
  S('bacheca', 'Bacheca', '/bacheca', 'Bacheca', 'Comunicati ai dipendenti'),
  S('ods', 'ODS', '/ods', 'ODS', 'Ordini di servizio', { badge: 'ods' }),
  S('dipendenti', 'Dipendenti', '/dipendenti', 'Dipendenti', 'Staff dei locali'),
  S('ristoranti', 'Ristoranti', '/ristoranti', 'Ristoranti', 'Locali, QR e fasce orarie'),
  S('prenotazioni', 'Prenotazioni', '/cassa/prenotazioni', 'Prenotazioni', 'Agenda del servizio'),
  S('timbrature', 'Timbrature', '/approvazioni', 'Approvazioni', 'Timbrature con foto e richieste', { badge: 'assenze' }),
  S('dashboard', 'Riepilogo', '/dashboard', 'Riepilogo', 'Presenze di oggi'),
  S('account', 'Account', '/account-pendenti', 'Account in attesa', 'Nuovi manager da approvare', { badge: 'account' }),
]

export const NAVIGAZIONE: Record<Ruolo, ConfigRuolo> = {
  manager: {
    stile: 'pillola',
    assistente: true,
    aree: [
      { key: 'home', label: 'Home', icona: 'home', href: '/hub', sezioni: [S('home', 'Home', '/hub', 'Home', undefined, { match: ['/hub'] })] },
      { key: 'turni', label: 'Turni', icona: 'turni', href: '/turni', sezioni: TURNI_MANAGER },
      { key: 'cassa', label: 'Cassa', icona: 'cassa', href: '/cassa/analisi', sezioni: CASSA_MANAGER },
      { key: 'acquisti', label: 'Acquisti', icona: 'acquisti', href: '/acquisti/fatture', sezioni: ACQUISTI },
      { key: 'altro', label: 'Altro', icona: 'altro', href: '/bacheca', sezioni: ALTRO_MANAGER, menu: true },
    ],
  },
  direttore: {
    stile: 'schede',
    intestazioneLocale: true,
    aree: [
      { key: 'home', label: 'Home', icona: 'home', href: '/dashboard', sezioni: [S('home', 'Home', '/dashboard', 'Home', undefined, { match: ['/dashboard', '/hub', '/approvazioni'] })] },
      { key: 'turni', label: 'Turni', icona: 'turni', href: '/turni', sezioni: [S('turni', 'Turni', '/turni', 'Turni')] },
      { key: 'acquisti', label: 'Acquisti', icona: 'acquisti', href: '/acquisti/fatture', sezioni: ACQUISTI },
      { key: 'report', label: 'Report', icona: 'report', href: '/report', sezioni: [S('report', 'Report', '/report', 'Report')] },
      {
        key: 'menu', label: 'Menu', icona: 'menu', href: '/ods', menu: true, sezioni: [
          S('ods', 'ODS', '/ods', 'ODS', undefined, { badge: 'ods' }),
          S('bacheca', 'Bacheca', '/bacheca', 'Bacheca'),
          S('dipendenti', 'Dipendenti', '/dipendenti', 'Dipendenti'),
          S('assenze', 'Assenze', '/assenze', 'Assenze', undefined, { badge: 'assenze' }),
        ],
      },
    ],
  },
  capo_servizio: {
    stile: 'schede',
    intestazioneLocale: true,
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
    aree: [
      { key: 'home', label: 'Home', icona: 'home', href: '/home', sezioni: [S('home', 'Home', '/home', 'Home', undefined, { match: ['/home'] })] },
      { key: 'ods', label: 'ODS', icona: 'ods', href: '/home/ods', sezioni: [S('ods', 'ODS', '/home/ods', 'Ordini di servizio', undefined, { badge: 'ods' })] },
      { key: 'turni', label: 'Turni', icona: 'turni', href: '/home/miei-turni', sezioni: [S('turni', 'Turni', '/home/miei-turni', 'I miei turni')] },
    ],
  },
  cassiere: {
    stile: 'pillola',
    aree: [
      { key: 'chiusura', label: 'Chiusura', icona: 'chiusura', href: '/cassa/chiusura', sezioni: [S('chiusura', 'Chiusura', '/cassa/chiusura', 'Chiusura cassa')] },
      { key: 'lista', label: 'Lista chiusure', icona: 'lista', href: '/cassa/lista-chiusure', sezioni: [S('lista', 'Lista chiusure', '/cassa/lista-chiusure', 'Lista chiusure')] },
    ],
  },
  hostess: {
    stile: 'pillola',
    aree: [
      { key: 'prenotazioni', label: 'Prenotazioni', icona: 'prenotazioni', href: '/cassa/prenotazioni', sezioni: [S('prenotazioni', 'Prenotazioni', '/cassa/prenotazioni', 'Prenotazioni', 'Agenda del servizio')] },
    ],
  },
  consulente_lavoro: {
    stile: 'pillola',
    aree: [
      { key: 'report', label: 'Report', icona: 'report', href: '/consulente/dashboard', sezioni: [S('report', 'Report', '/consulente/dashboard', 'Report', 'Presenze e ore dei locali')] },
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
