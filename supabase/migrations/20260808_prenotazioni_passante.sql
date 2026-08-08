-- Tavolo per un passante (walk-in): entra direttamente fra i seduti,
-- senza passare da una prenotazione vera — non ha nome, non ha orario
-- scelto da nessuno, solo il numero di persone. Il flag distingue questa
-- riga dalle prenotazioni normali per l'interfaccia (non cliccabile, non
-- torna a "confermata", si rimuove solo cancellandola), non incide sulle
-- regole di sicurezza: restano le stesse di qualunque altra riga della
-- tabella.
ALTER TABLE public.prenotazioni ADD COLUMN passante boolean NOT NULL DEFAULT false;
