-- Chi ha segnato l'ultimo cambio stato (seduta/no show/cancellata) e con
-- quale ruolo — nome e ruolo salvati come testo semplice sulla riga
-- stessa, non un riferimento a profiles(id): un join dovrebbe passare
-- dalla RLS di profiles, che non copre affatto l'hostess (solo "vedi te
-- stesso") — un manager che segna uno stato resterebbe invisibile a una
-- hostess che guarda la stessa prenotazione, e viceversa. Il testo
-- salvato al momento del cambio evita il problema alla radice, a costo
-- di restare quello che era anche se il nome dell'utente cambia dopo.
ALTER TABLE public.prenotazioni
  ADD COLUMN stato_modificato_da_nome  text,
  ADD COLUMN stato_modificato_da_ruolo text;
