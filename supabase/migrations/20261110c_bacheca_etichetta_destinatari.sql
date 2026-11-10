-- Area ALTRO (Bacheca, ODS, Dipendenti, Ristoranti) — migrazioni proposte.
-- Nessuna è indispensabile: il codice funziona già senza e degrada.

-- 1. Etichetta dei destinatari di un comunicato, come scelta nel foglio
--    "Nuovo comunicato" del design (es. "Centro · Capi servizio, Direttori",
--    "Tutti i locali · Cucina, Pizzeria"). Le combinazioni che non hanno un
--    bersaglio "aperto" (più reparti, ruolo + locale, solo direttori…) si
--    salvano come target = 'users' con l'elenco esatto delle persone: senza
--    questa colonna la colonna Destinatari mostra "N persone".
--    /api/bacheca prova a scriverla e, se manca, salva senza.
ALTER TABLE public.bulletins ADD COLUMN IF NOT EXISTS target_label text;

-- Nessuna nuova RPC, nessuna modifica alla RLS: l'inserimento del
-- comunicato resta fatto con il client dell'utente (RLS di bulletins), le
-- notifiche con il client amministratore dopo i controlli di perimetro
-- espliciti in src/app/api/bacheca/route.ts.

-- 2. (Da decidere con l'utente, NON applicare senza conferma) "Anzianità"
--    Junior/Senior del dettaglio Dipendenti nel design non ha una colonna:
--    oggi si mostra solo "Può sostituire il capo servizio"
--    (can_substitute_capo_servizio). Se serve un campo distinto:
-- ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS seniority text CHECK (seniority IN ('junior','senior'));
