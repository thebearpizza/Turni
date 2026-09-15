-- Task 3 (nuova Home Manager): indicatori delle 3 card (Turni, Cassa,
-- Acquisti), una funzione per area così ciascuna può fallire/andare in
-- timeout indipendentemente dalle altre (la pagina le invoca in parallelo,
-- ognuna nel proprio Suspense boundary — vedi src/app/hub/page.tsx).
--
-- Tutte SECURITY INVOKER (default): nessun parametro di scope, la RLS di
-- attendances/absences/cassa_chiusure/fatture/restaurants fa già il suo
-- lavoro secondo can_manage_restaurant() per chi chiama — un manager con
-- managed_restaurant_ids limitato vede solo i propri locali, un
-- proprietario di piattaforma (managed_restaurant_ids null) li vede
-- tutti, automaticamente, senza bisogno di passare id qui.
--
-- Le date/timestamp di confine (oggi, ieri, inizio/fine mese) sono
-- calcolati lato Node con date-fns-tz (Europe/Rome) e passati come
-- parametri: stesso approccio già in uso altrove nel repo (SQL non
-- assume timezone).

create or replace function public.hub_indicatori_turni(p_oggi date, p_oggi_inizio_utc timestamptz)
returns table (
  presenti_ora bigint,
  richieste_da_approvare bigint,
  assenze_oggi bigint
)
language sql
security invoker
stable
as $$
  select
    (select count(*) from attendances a where a.check_out is null and a.check_in >= p_oggi_inizio_utc) as presenti_ora,
    (select count(*) from absences ab where ab.status = 'pending') as richieste_da_approvare,
    (select count(*) from absences ab where ab.status = 'approved' and ab.start_date <= p_oggi and ab.end_date >= p_oggi) as assenze_oggi
$$;

-- p_giorni_trascorsi: numero di giorni da inizio mese a ieri (0 se oggi è
-- il primo del mese) — "chiusure mancanti" assume il locale sempre
-- aperto (nessun calendario di apertura/chiusura nel sistema oggi) e non
-- conta la giornata odierna, ancora in corso.
create or replace function public.hub_indicatori_cassa(p_mese_inizio date, p_mese_fine date, p_ieri date, p_giorni_trascorsi int)
returns table (
  totale_entrate_mese numeric,
  chiusure_mancanti bigint,
  differenza_mese numeric
)
language sql
security invoker
stable
as $$
  select
    coalesce((select sum(c.totale_entrate) from cassa_chiusure c where c.data >= p_mese_inizio and c.data <= p_mese_fine), 0) as totale_entrate_mese,
    greatest(0, (select count(*) from restaurants r) * p_giorni_trascorsi - (select count(*) from cassa_chiusure c where c.data >= p_mese_inizio and c.data <= p_ieri)) as chiusure_mancanti,
    coalesce((select sum(c.differenza) from cassa_chiusure c where c.data >= p_mese_inizio and c.data <= p_mese_fine), 0) as differenza_mese
$$;

create or replace function public.hub_indicatori_acquisti(p_mese_inizio date, p_mese_fine date)
returns table (
  fatture_mese bigint,
  fatture_da_verificare bigint,
  spesa_merce_mese numeric
)
language sql
security invoker
stable
as $$
  select
    (select count(*) from fatture f where f.data >= p_mese_inizio and f.data <= p_mese_fine) as fatture_mese,
    (select count(*) from fatture f where jsonb_array_length(f.verifiche_sospette) > 0) as fatture_da_verificare,
    coalesce((select sum(f.totale_lordo) from fatture f where f.ha_articoli and f.data >= p_mese_inizio and f.data <= p_mese_fine), 0) as spesa_merce_mese
$$;
