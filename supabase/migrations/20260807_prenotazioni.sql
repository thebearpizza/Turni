-- Tab "Prenotazioni" (solo manager): un'unica agenda che accorpa i due
-- libri visite in uso a Porto Rotondo (TheFork e Restoo) più le
-- prenotazioni inserite a mano o importate da file (Excel/PDF).
--
-- Le prenotazioni NON arrivano da un'API dei due gestionali (non è
-- disponibile per i partner): arrivano dalle mail di notifica che il
-- ristorante riceve a ogni nuova prenotazione / modifica / disdetta,
-- lette periodicamente dalla casella e interpretate dall'AI. Perciò
-- serve anche una tabella di log delle mail lavorate: dà idempotenza
-- (una mail già vista non viene riprocessata) e permette di rileggere
-- una mail se il parser va migliorato.

-- ── Insegne ──────────────────────────────────────────────────────────
-- "Crunch! - Porto Rotondo" e "Benthos Porto Rotondo" sono lo stesso
-- locale con due insegne (e due libri visite) distinti: le prenotazioni
-- devono finire nello stesso ristorante — così l'agenda del servizio è
-- una sola — ma restare distinguibili a colpo d'occhio in lista.
-- Tabella e non enum perché il riconoscimento parte dal nome del locale
-- scritto nella mail: aggiungere un'insegna o correggere il testo da
-- cercare deve essere un INSERT, non una migration.
CREATE TABLE IF NOT EXISTS public.prenotazioni_insegne (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  codice        text NOT NULL,
  etichetta     text NOT NULL,
  -- Sottostringa (case-insensitive) cercata nel testo della mail per
  -- attribuire la prenotazione a questa insegna.
  pattern       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, codice)
);

-- ── Prenotazioni ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prenotazioni (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  insegna             text,
  origine             text NOT NULL CHECK (origine IN ('thefork','restoo','manuale','import')),
  -- Codice prenotazione del gestionale, quando la mail lo riporta: è la
  -- chiave che permette di applicare modifiche e disdette successive
  -- alla riga giusta invece di creare un doppione.
  riferimento_esterno text,
  data                date NOT NULL,
  orario              time NOT NULL,
  servizio            text NOT NULL CHECK (servizio IN ('pranzo','cena')),
  nome                text NOT NULL,
  cognome             text,
  persone             integer NOT NULL DEFAULT 1 CHECK (persone >= 0),
  bambini             integer NOT NULL DEFAULT 0 CHECK (bambini >= 0),
  -- Solo TheFork: sconto promozionale applicato alla prenotazione.
  sconto_percentuale  numeric(5,2) CHECK (sconto_percentuale >= 0 AND sconto_percentuale <= 100),
  telefono            text,
  email               text,
  note                text,
  stato               text NOT NULL DEFAULT 'confermata'
                        CHECK (stato IN ('confermata','seduta','no_show','eliminata')),
  seduta_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- L'agenda si legge sempre per locale + giorno + servizio.
CREATE INDEX IF NOT EXISTS prenotazioni_agenda_idx
  ON public.prenotazioni (restaurant_id, data, servizio, orario);

-- Idempotenza degli aggiornamenti che arrivano via mail: una seconda
-- mail sulla stessa prenotazione aggiorna la riga esistente.
CREATE UNIQUE INDEX IF NOT EXISTS prenotazioni_riferimento_esterno_idx
  ON public.prenotazioni (restaurant_id, origine, riferimento_esterno)
  WHERE riferimento_esterno IS NOT NULL;

DROP TRIGGER IF EXISTS prenotazioni_updated_at ON public.prenotazioni;
CREATE TRIGGER prenotazioni_updated_at
  BEFORE UPDATE ON public.prenotazioni
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── Log delle mail lavorate ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prenotazioni_email_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id  text NOT NULL UNIQUE,
  gmail_thread_id   text,
  ricevuta_at       timestamptz,
  mittente          text,
  oggetto           text,
  -- 'importata' = ha prodotto/aggiornato una prenotazione;
  -- 'ignorata'  = mail dei due mittenti ma non di prenotazione (report
  --               pagamenti, fatture, marketing);
  -- 'errore'    = riconosciuta come prenotazione ma non interpretabile,
  --               resta qui per essere riletta dopo.
  esito             text NOT NULL CHECK (esito IN ('importata','ignorata','errore')),
  evento            text CHECK (evento IN ('nuova','modifica','cancellazione')),
  errore            text,
  payload           jsonb,
  prenotazione_id   uuid REFERENCES public.prenotazioni(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prenotazioni_email_log_created_idx
  ON public.prenotazioni_email_log (created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Funzionalità dichiaratamente solo-manager: nessuna policy per
-- cassiere/capo servizio. La sincronizzazione da mail gira con la
-- service role, che bypassa RLS.
ALTER TABLE public.prenotazioni           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prenotazioni_insegne   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prenotazioni_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prenotazioni_manager_all ON public.prenotazioni;
CREATE POLICY prenotazioni_manager_all ON public.prenotazioni
  FOR ALL
  USING      (public.can_manage_restaurant(restaurant_id))
  WITH CHECK (public.can_manage_restaurant(restaurant_id));

DROP POLICY IF EXISTS prenotazioni_insegne_manager_select ON public.prenotazioni_insegne;
CREATE POLICY prenotazioni_insegne_manager_select ON public.prenotazioni_insegne
  FOR SELECT
  USING (public.can_manage_restaurant(restaurant_id));

-- Il log serve al manager per capire perché una prenotazione non è
-- comparsa: sola lettura, e solo per chi è manager di almeno un locale.
DROP POLICY IF EXISTS prenotazioni_email_log_manager_select ON public.prenotazioni_email_log;
CREATE POLICY prenotazioni_email_log_manager_select ON public.prenotazioni_email_log
  FOR SELECT
  USING (public.get_my_role() = 'manager');

-- ── Seed insegne Porto Rotondo ───────────────────────────────────────
INSERT INTO public.prenotazioni_insegne (restaurant_id, codice, etichetta, pattern)
SELECT r.id, v.codice, v.etichetta, v.pattern
FROM public.restaurants r
CROSS JOIN (VALUES
  ('crunch',  'Crunch!',  'crunch'),
  ('benthos', 'Benthos',  'benthos')
) AS v(codice, etichetta, pattern)
WHERE r.name = 'Crunch! - Porto Rotondo'
ON CONFLICT (restaurant_id, codice) DO NOTHING;

-- ── Pianificazione della lettura casella ─────────────────────────────
-- Lo scheduler è pg_cron (stesso meccanismo già usato in questo progetto
-- per i reminder e per close_stale_shifts), non il cron di Vercel: così
-- la frequenza non dipende dal piano Vercel. Da eseguire UNA VOLTA dopo
-- aver impostato CRON_SECRET fra le variabili d'ambiente dell'app:
--
--   SELECT cron.schedule(
--     'sync-prenotazioni',
--     '*/10 * * * *',
--     $$ SELECT net.http_get(
--          url     := 'https://<dominio-app>/api/cassa/prenotazioni/sync',
--          headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
--        ) $$
--   );
