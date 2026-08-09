-- La cassiera può ora aggiungere/eliminare/modificare le uscite anche
-- quando la chiusura è già confermata, come già poteva fare un manager
-- (cassa_spese_manager_all non ha mai avuto questa condizione). Le tre
-- policy per il cassiere richiedevano c.stato <> 'confermata', bloccando
-- del tutto la modifica delle spese su una chiusura confermata — a
-- differenza dei campi di quadratura, che per il cassiere passano da
-- un'approvazione del manager (cassa_chiusure_modifiche), le spese non
-- hanno un simile percorso: restano quindi modificabili direttamente,
-- come per il manager. Resta invariato lo scoping al proprio ristorante.
drop policy if exists cassa_spese_cassiere_insert on public.cassa_spese;
create policy cassa_spese_cassiere_insert on public.cassa_spese
  for insert
  with check (
    exists (
      select 1 from cassa_chiusure c
      where c.id = cassa_spese.chiusura_id
        and get_my_role() = 'cassiere'
        and c.restaurant_id = get_my_restaurant_id()
    )
  );

drop policy if exists cassa_spese_cassiere_update on public.cassa_spese;
create policy cassa_spese_cassiere_update on public.cassa_spese
  for update
  using (
    exists (
      select 1 from cassa_chiusure c
      where c.id = cassa_spese.chiusura_id
        and get_my_role() = 'cassiere'
        and c.restaurant_id = get_my_restaurant_id()
    )
  )
  with check (
    exists (
      select 1 from cassa_chiusure c
      where c.id = cassa_spese.chiusura_id
        and get_my_role() = 'cassiere'
        and c.restaurant_id = get_my_restaurant_id()
    )
  );

drop policy if exists cassa_spese_cassiere_delete on public.cassa_spese;
create policy cassa_spese_cassiere_delete on public.cassa_spese
  for delete
  using (
    exists (
      select 1 from cassa_chiusure c
      where c.id = cassa_spese.chiusura_id
        and get_my_role() = 'cassiere'
        and c.restaurant_id = get_my_restaurant_id()
    )
  );
