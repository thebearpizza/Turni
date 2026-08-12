-- Una presenza con timbratura di emergenza sia in ingresso che in uscita
-- aveva una sola colonna foto: la seconda sovrascriveva la prima, e il
-- rifiuto cancellava l'intera riga anche quando solo l'uscita era in
-- discussione (l'ingresso, magari regolare via QR, andava perso con essa).
-- Due colonne distinte permettono di trattare le due prove separatamente.
alter table public.attendances
  rename column fallback_photo_path to fallback_photo_path_in;

alter table public.attendances
  add column fallback_photo_path_out text;
