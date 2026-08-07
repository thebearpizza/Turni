-- L'import assegnava come insegna di ripiego quella con `priorita` più
-- bassa. Sbagliato: `priorita` ordina il RICONOSCIMENTO testuale (Benthos
-- va provato prima di Crunch, perché "Benthos Porto Rotondo" contiene
-- anche "porto rotondo"), non dice quale insegna sia quella di casa.
-- Risultato: un export in cui il gestionale non ripete il nome del locale
-- riga per riga finiva tutto etichettato "Benthos", Crunch! compreso.
--
-- Serve un flag esplicito e separato: l'insegna principale del locale è
-- quella a cui attribuire una prenotazione quando il documento non dice
-- altro.
ALTER TABLE public.prenotazioni_insegne
  ADD COLUMN IF NOT EXISTS principale boolean NOT NULL DEFAULT false;

-- Una sola principale per locale: se ce ne fossero due, il ripiego
-- tornerebbe ad essere arbitrario come prima.
CREATE UNIQUE INDEX IF NOT EXISTS prenotazioni_insegne_una_principale_idx
  ON public.prenotazioni_insegne (restaurant_id)
  WHERE principale;

UPDATE public.prenotazioni_insegne SET principale = true  WHERE codice = 'crunch';
UPDATE public.prenotazioni_insegne SET principale = false WHERE codice <> 'crunch';
