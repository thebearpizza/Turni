-- Come già scoperto per close_stale_shifts: Supabase concede EXECUTE su
-- ogni nuova funzione esplicitamente ad anon e authenticated (privilegi di
-- default a livello di schema), non solo tramite il chiamante PUBLIC —
-- "REVOKE ALL ... FROM PUBLIC" da solo non li rimuove. Questa funzione deve
-- restare eseguibile solo dal client admin (service_role) di confirmAiDraft.
REVOKE EXECUTE ON FUNCTION public.confirm_ai_draft_replace(uuid, date, date, text[], jsonb) FROM anon, authenticated;
