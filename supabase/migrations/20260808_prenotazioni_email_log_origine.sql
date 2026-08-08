-- prenotazioni_email_log finora assumeva un'unica via d'ingresso (Gmail):
-- le colonne gmail_message_id / gmail_thread_id lo dicono nel nome.
-- Con l'aggiunta di un webhook di posta in entrata (CloudMailin) come
-- seconda via, quel nome sarebbe fuorviante — vi finirebbero dentro id
-- di messaggi che non sono affatto di Gmail. Si generalizza il nome e si
-- aggiunge una colonna esplicita per distinguere la provenienza.
ALTER TABLE public.prenotazioni_email_log RENAME COLUMN gmail_message_id TO message_id;
ALTER TABLE public.prenotazioni_email_log RENAME COLUMN gmail_thread_id  TO thread_id;

ALTER TABLE public.prenotazioni_email_log
  ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'gmail' CHECK (origine IN ('gmail', 'cloudmailin'));

COMMENT ON COLUMN public.prenotazioni_email_log.message_id IS
  'Identificativo univoco del messaggio secondo la sua fonte: message id di Gmail, oppure hash calcolato per le mail arrivate via webhook.';

-- L'unicità era su message_id da solo: corretto finché la fonte era una
-- sola, ma un hash CloudMailin e un id Gmail non hanno nessuna garanzia
-- di non coincidere per puro caso. La si sposta sulla coppia
-- (origine, message_id), l'unica davvero univoca ora che le fonti sono due.
ALTER TABLE public.prenotazioni_email_log DROP CONSTRAINT prenotazioni_email_log_gmail_message_id_key;
ALTER TABLE public.prenotazioni_email_log ADD CONSTRAINT prenotazioni_email_log_origine_message_id_key UNIQUE (origine, message_id);
