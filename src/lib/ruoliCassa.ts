// Chi vede le sezioni del manager in Cassa (Analisi, Utile, Chiusure,
// Approvazioni, Buste): il manager e il Controllo di gestione, che le vede
// per i soli locali assegnati (lo limita il database) e in sola lettura.
export const vedeCassaManager = (role?: string | null) => role === 'manager' || role === 'controllo_gestione'
export const solaLetturaCassa = (role?: string | null) => role === 'controllo_gestione'
