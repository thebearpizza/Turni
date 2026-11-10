-- Home del direttore (Direttore Smartphone / Tablet v2, MTHome "single"):
-- la card "Coperti · ieri / Media scontrino / Coperti della settimana scorsa"
-- legge cassa_chiusure del proprio locale. Le policy di cassa_chiusure non
-- sono nel repo (schema iniziale fuori da supabase/migrations): VERIFICARE
-- prima con
--   select policyname, cmd, qual from pg_policies where tablename = 'cassa_chiusure';
-- Applicare SOLO se il direttore oggi non vede le chiusure del suo locale
-- (in quel caso la card mostra "—" e il resto della Home funziona).
-- Sola lettura, solo chiusure confermate, solo il proprio locale.

create policy cassa_chiusure_direttore_select on public.cassa_chiusure
  for select to authenticated
  using (
    stato = 'confermata'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'capo_servizio'
        and p.is_direttore = true
        and p.restaurant_id = cassa_chiusure.restaurant_id
    )
  );

-- Facoltativa: motivo della timbratura con foto ("fuori area GPS",
-- "GPS assente"), mostrato nel foglio "Timbratura di …" (Direttore v2, 9a).
-- Oggi il foglio scrive "GPS non verificato" per tutte. Andrebbe valorizzata
-- da /api/clock-in-fallback con l'esito della verifica GPS del client.
alter table public.attendances add column if not exists fallback_motivo text;
