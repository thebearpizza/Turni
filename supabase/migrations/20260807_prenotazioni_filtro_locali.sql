-- Alla stessa casella arrivano le notifiche di TUTTI i locali del gruppo,
-- ma questa agenda è solo di Porto Rotondo (insegne Crunch! e Benthos).
-- Le prenotazioni di Talenti, Dazio e Teglia NON devono mai finirci: ogni
-- locale ha il proprio libro visite e mischiarle renderebbe l'agenda
-- inservibile nel momento del servizio.
--
-- Il riconoscimento passa da singola sottostringa a insieme di termini che
-- devono comparire TUTTI. Il vecchio pattern 'crunch' catturava anche
-- "Crunch! - Talenti": ora l'insegna di Porto Rotondo richiede sia 'crunch'
-- sia 'porto rotondo', quindi Talenti non può più corrispondere.
ALTER TABLE public.prenotazioni_insegne
  ADD COLUMN IF NOT EXISTS termini  text[]  NOT NULL DEFAULT '{}',
  -- Ordine di valutazione: "Benthos Porto Rotondo" va riconosciuto come
  -- Benthos anche se il testo del locale nominasse pure Crunch.
  ADD COLUMN IF NOT EXISTS priorita integer NOT NULL DEFAULT 100;

UPDATE public.prenotazioni_insegne SET termini = ARRAY['benthos'], priorita = 1 WHERE codice = 'benthos';
UPDATE public.prenotazioni_insegne SET termini = ARRAY['crunch','porto rotondo'], priorita = 2 WHERE codice = 'crunch';

ALTER TABLE public.prenotazioni_insegne DROP COLUMN IF EXISTS pattern;

-- Lista di veto esplicita. Non sarebbe strettamente necessaria — l'elenco
-- delle insegne è già un allow-list e da solo basta a tenere fuori gli altri
-- locali — ma senza, ogni notifica di Talenti/Dazio/Teglia finirebbe nel log
-- come 'errore: locale non riconosciuto', cioè come un guasto da indagare
-- invece che come il comportamento voluto.
CREATE TABLE IF NOT EXISTS public.prenotazioni_locali_ignorati (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  termine    text NOT NULL UNIQUE,
  motivo     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prenotazioni_locali_ignorati ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prenotazioni_locali_ignorati_manager_select ON public.prenotazioni_locali_ignorati;
CREATE POLICY prenotazioni_locali_ignorati_manager_select ON public.prenotazioni_locali_ignorati
  FOR SELECT
  USING (public.get_my_role() = 'manager');

INSERT INTO public.prenotazioni_locali_ignorati (termine, motivo) VALUES
  ('talenti', 'Crunch! - Talenti ha un proprio libro visite: le sue prenotazioni non entrano in questa agenda'),
  ('dazio',   'Dazio ha un proprio libro visite: le sue prenotazioni non entrano in questa agenda'),
  ('teglia',  'Crunch! Teglia ha un proprio libro visite: le sue prenotazioni non entrano in questa agenda')
ON CONFLICT (termine) DO NOTHING;
