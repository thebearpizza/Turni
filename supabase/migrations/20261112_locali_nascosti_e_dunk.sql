-- Locali nascosti (chiusi o stagionali): restano con tutti i loro dati ma
-- non compaiono fra i locali attivi né in "Tutti"; il manager li riapre uno
-- alla volta dall'archivio in Ristoranti.
alter table public.restaurants add column if not exists nascosto boolean not null default false;

-- Dunk prende il posto di Crunch! Teglia dal 6 novembre 2026: nuovo locale
-- con le stesse impostazioni, le chiusure (e le bozze di spesa) dal 6
-- novembre e l'account cassiere. Crunch! Teglia e Crunch! - Porto Rotondo
-- (stagionale, chiuso) diventano nascosti. Già applicata in produzione.
do $$
declare v_teglia uuid; v_dunk uuid;
begin
  select id into v_teglia from public.restaurants where name = 'Crunch! Teglia';
  if v_teglia is null then raise exception 'Crunch! Teglia non trovato'; end if;
  select id into v_dunk from public.restaurants where name = 'Dunk';
  if v_dunk is null then
    insert into public.restaurants (name, address, latitude, longitude, closing_days, is_demo, owner_id, codice_destinatario, riferimenti_fatture)
    select 'Dunk', address, latitude, longitude, closing_days, is_demo, owner_id, codice_destinatario, array['Dunk']::text[]
    from public.restaurants where id = v_teglia
    returning id into v_dunk;
  end if;
  update public.cassa_chiusure set restaurant_id = v_dunk where restaurant_id = v_teglia and data >= date '2026-11-06';
  update public.cassa_spese_bozza set restaurant_id = v_dunk where restaurant_id = v_teglia and data >= date '2026-11-06';
  update public.profiles set restaurant_id = v_dunk where restaurant_id = v_teglia;
  update public.profiles set managed_restaurant_ids = array_append(managed_restaurant_ids, v_dunk)
    where v_teglia = any(managed_restaurant_ids) and not (v_dunk = any(managed_restaurant_ids));
  update public.restaurants set nascosto = true where id = v_teglia or name = 'Crunch! - Porto Rotondo';
end $$;
