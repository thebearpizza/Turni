<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Flusso di lavoro per le feature

Turni è in uso reale in ristoranti veri: trattare ogni modifica con la cura dovuta a un'app in produzione, non a un progetto giocattolo.

- Ogni feature sostanziale va sul proprio branch `feature/*` creato da `main`, mai committata direttamente su `main`.
- Prima di pushare: `npx tsc --noEmit`, `npx eslint` sui file toccati, `npx next build` devono essere puliti. Eccezione nota: il warning `react-hooks/set-state-in-effect` su `useEffect(() => { load() }, [load])` è preesistente in tutto il codebase (pattern "carica al mount") — non è una regressione, non va corretto ad hoc.
- Dopo ogni migrazione Supabase, verificare con l'advisor di sicurezza che non compaiano nuove categorie di avviso oltre a quelle già note.
- Mai eseguire il merge su `main` senza un'istruzione esplicita dell'utente — costruire e verificare sul branch va bene, il merge no.
- Cambiare la lista di parametri di una funzione Postgres con `CREATE OR REPLACE FUNCTION` crea un OVERLOAD, non una sostituzione: se cambia la firma va prima eseguito un `DROP FUNCTION` con la firma esatta precedente.
- Una RPC `SECURITY DEFINER` che scavalca RLS deve sempre avere un controllo di autorizzazione esplicito in testa (stesso pattern di `registra_consumo_chiusura`, `abbina_prodotto_venduto`, ecc.) — non basta che sia privilegiata.
- Abbinamento tra testo libero (nome fornitore, nome prodotto venduto...) e righe di catalogo: sempre per nome esatto (trim, case-insensitive quando serve), mai fuzzy — prevedibilità sopra comodità, coerente con come Inventario accorpa già gli articoli.
- Prima di una decisione di prodotto ambigua (un caso limite, come etichettare/aggregare un dato) chiedere all'utente invece di indovinare.
- Commit e messaggi verso l'utente in italiano; il messaggio di commit spiega il perché della modifica, non ripete il diff.
- Dopo un push su un branch, recuperare e comunicare il link di Preview Vercel del deployment.
