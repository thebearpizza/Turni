-- Le notifiche "Nuova prenotazione" di TheFork non scrivono l'orario da
-- nessuna parte (nemmeno nel link "Vedi i dettagli"): nome e data si
-- riescono a ricavare, l'orario no. Finora quella mancanza finiva
-- indistinguibile da un errore vero e proprio (locale sconosciuto, dati
-- del tutto assenti) sotto lo stesso esito 'errore'. Ora è un esito a
-- sé — 'incompleta' — con i dati già noti salvati nel payload, pronti
-- per una coda di completamento manuale nella tab Prenotazioni invece
-- di restare sepolti in un log diagnostico.
ALTER TABLE public.prenotazioni_email_log DROP CONSTRAINT prenotazioni_email_log_esito_check;
ALTER TABLE public.prenotazioni_email_log ADD CONSTRAINT prenotazioni_email_log_esito_check
  CHECK (esito IN ('importata','ignorata','errore','incompleta'));

-- Il manager deve poter "risolvere" una voce in coda — completandola
-- (esito → importata) o scartandola (esito → ignorata). Finora la
-- tabella era di sola lettura per i manager, scritta solo dal backend
-- con la service role. Stessa scelta di ambito della SELECT già
-- esistente (qualunque manager, non filtrato per ristorante): la tabella
-- non ha una colonna restaurant_id propria, e restringere solo la
-- scrittura lascerebbe comunque visibili in lettura le voci degli altri
-- locali — incoerente senza toccare anche la policy di lettura, il che
-- va oltre lo scopo di questa modifica.
DROP POLICY IF EXISTS prenotazioni_email_log_manager_update ON public.prenotazioni_email_log;
CREATE POLICY prenotazioni_email_log_manager_update ON public.prenotazioni_email_log
  FOR UPDATE
  USING      (public.get_my_role() = 'manager')
  WITH CHECK (public.get_my_role() = 'manager');

-- La coda deve aggiornarsi da sola quando arriva una nuova mail
-- incompleta (o quando un'altra sessione ne risolve una), senza che il
-- manager debba ricaricare la pagina per vederlo.
ALTER PUBLICATION supabase_realtime ADD TABLE public.prenotazioni_email_log;
