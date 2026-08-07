-- I libri visite stampano i coperti come "10/9" quando ci sono 10 adulti
-- e 9 bambini: per il servizio quel tavolo è da 19 coperti, ed è 19 che
-- deve comparire in agenda. Il totale in fondo all'export ("47 PAX") si
-- ottiene sommando così, quindi è anche la lettura che quadra col
-- documento.
--
-- Cambia il significato di persone: da "solo adulti" (con bambini da
-- sommare a parte) a "coperti totali", con bambini che diventa un
-- sottoinsieme informativo. La tabella era ancora vuota, quindi non c'è
-- nulla da convertire.
ALTER TABLE public.prenotazioni DROP CONSTRAINT IF EXISTS prenotazioni_bambini_check;
ALTER TABLE public.prenotazioni ADD CONSTRAINT prenotazioni_bambini_sottoinsieme
  CHECK (bambini >= 0 AND bambini <= persone);

COMMENT ON COLUMN public.prenotazioni.persone IS
  'Coperti TOTALI della prenotazione, bambini inclusi. I libri visite stampano "10/9" per 10 adulti e 9 bambini: qui va 19, il numero che conta per il servizio.';
COMMENT ON COLUMN public.prenotazioni.bambini IS
  'Quanti dei coperti in persone sono bambini (sottoinsieme, non da sommare). 0 quando il libro visite non distingue.';
