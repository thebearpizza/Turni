-- profiles_role_check esisteva già sul DB (applicato fuori dalle migration
-- tracciate in questo repo, prima che questa cronologia iniziasse) e non
-- era stato aggiornato quando è stato introdotto il ruolo hostess lato
-- applicazione (20260808_hostess_role_prenotazioni.sql): salvare un
-- profilo con quel ruolo falliva con "violates check constraint
-- profiles_role_check" — trovato in produzione creando il primo account.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['manager'::text, 'capo_servizio'::text, 'dipendente'::text, 'consulente_lavoro'::text, 'cassiere'::text, 'hostess'::text]));
