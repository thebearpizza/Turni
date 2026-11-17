-- Ruolo "Controllo di gestione": vede solo l'area Cassa (Analisi, Utile,
-- Chiusure, Approvazioni, Buste) di uno o più locali assegnati, in sola
-- lettura. I locali stanno in gestione_restaurant_ids; restaurant_id è il
-- primo di questi, così il profilo compare in Dipendenti come gli altri.
-- Solo policy di SELECT: nessuna scrittura è concessa al ruolo.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['manager', 'capo_servizio', 'dipendente', 'consulente_lavoro', 'cassiere', 'hostess', 'controllo_gestione']));

alter table public.profiles add column if not exists gestione_restaurant_ids uuid[] not null default '{}';

-- Locali assegnati a chi chiama, solo se ha davvero il ruolo (stesso
-- schema di get_my_consultant_restaurants: legge solo la propria riga).
create or replace function public.get_my_gestione_restaurants()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when role = 'controllo_gestione' then coalesce(gestione_restaurant_ids, '{}') else '{}'::uuid[] end
  from profiles where id = auth.uid()
$function$;

-- Nessuno può assegnarsi da solo dei locali da controllare.
create or replace function public.prevent_self_privilege_escalation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and auth.uid() = new.id then
    if new.role is distinct from old.role
       or new.account_status is distinct from old.account_status
       or new.managed_restaurant_ids is distinct from old.managed_restaurant_ids
       or new.restaurant_id is distinct from old.restaurant_id
       or new.is_direttore is distinct from old.is_direttore
       or new.gestione_restaurant_ids is distinct from old.gestione_restaurant_ids
    then
      raise exception 'Non puoi modificare da solo il tuo ruolo, stato account, ristorante o ristoranti gestiti.';
    end if;
  end if;
  return new;
end;
$function$;

-- ── Sola lettura sui locali assegnati ─────────────────────────────────
create policy gestione_select on public.restaurants for select to authenticated
  using (id = any (get_my_gestione_restaurants()));

create policy gestione_select on public.cassa_chiusure for select to authenticated
  using (restaurant_id = any (get_my_gestione_restaurants()));

create policy gestione_select on public.cassa_spese for select to authenticated
  using (exists (select 1 from cassa_chiusure c where c.id = cassa_spese.chiusura_id and c.restaurant_id = any (get_my_gestione_restaurants())));

create policy gestione_select on public.cassa_vendite_prodotti for select to authenticated
  using (exists (select 1 from cassa_chiusure c where c.id = cassa_vendite_prodotti.chiusura_id and c.restaurant_id = any (get_my_gestione_restaurants())));

create policy gestione_select on public.cassa_chiusure_modifiche for select to authenticated
  using (exists (select 1 from cassa_chiusure c where c.id = cassa_chiusure_modifiche.chiusura_id and c.restaurant_id = any (get_my_gestione_restaurants())));

create policy gestione_select on public.cassa_categorie for select to authenticated
  using (exists (select 1 from restaurants r where r.owner_id = cassa_categorie.owner_id and r.id = any (get_my_gestione_restaurants())));

create policy gestione_select on public.fatture for select to authenticated
  using (restaurant_id = any (get_my_gestione_restaurants()));

create policy gestione_select on public.fatture_articoli for select to authenticated
  using (exists (select 1 from fatture f where f.id = fatture_articoli.fattura_id and f.restaurant_id = any (get_my_gestione_restaurants())));

create policy gestione_select on public.fatture_iva_dettaglio for select to authenticated
  using (exists (select 1 from fatture f where f.id = fatture_iva_dettaglio.fattura_id and f.restaurant_id = any (get_my_gestione_restaurants())));

create policy gestione_select on public.fornitori for select to authenticated
  using (exists (select 1 from restaurants r where r.owner_id = fornitori.owner_id and r.id = any (get_my_gestione_restaurants())));

create policy gestione_select on public.catalogo_articoli for select to authenticated
  using (exists (select 1 from restaurants r where r.owner_id = catalogo_articoli.owner_id and r.id = any (get_my_gestione_restaurants())));

create policy gestione_select on public.categorie_fatture_dirette for select to authenticated
  using (exists (select 1 from restaurants r where r.owner_id = categorie_fatture_dirette.owner_id and r.id = any (get_my_gestione_restaurants())));

-- Spese di gestione: anche quelle condivise con altri locali (se ne
-- mostra la quota dei locali assegnati), altrimenti l'utile sarebbe falso.
create policy gestione_select on public.costi_gestione for select to authenticated
  using (restaurant_ids && get_my_gestione_restaurants());

create policy gestione_select on public.utile_mesi_completi for select to authenticated
  using (restaurant_id = any (get_my_gestione_restaurants()));

-- Nomi di chi ha inviato chiusure e modifiche nei locali assegnati.
create policy gestione_select on public.profiles for select to authenticated
  using (restaurant_id = any (get_my_gestione_restaurants()));
