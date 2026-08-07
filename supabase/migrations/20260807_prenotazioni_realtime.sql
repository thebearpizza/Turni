-- L'agenda prenotazioni viene scritta anche da fuori app (il job che
-- legge la casella dei libri visite): senza replica realtime la tab
-- resterebbe ferma allo stato in cui è stata aperta, proprio durante il
-- servizio, quando le prenotazioni dell'ultimo minuto sono quelle che
-- contano di più.
ALTER PUBLICATION supabase_realtime ADD TABLE public.prenotazioni;
