-- Presenze inserite o corrette a mano dal manager/direttore: la chiusura
-- automatica delle uscite dimenticate (autoCloseStaleShifts, ingresso +7h
-- dopo 16 ore aperte) non le tocca. Prima un ingresso inserito a mano
-- senza uscita veniva chiuso da solo (es. 16:30 → 23:30).
alter table public.attendances add column if not exists inserita_a_mano boolean not null default false;
