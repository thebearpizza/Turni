-- Spese annotate durante il servizio, prima che esista una chiusura per
-- quel giorno (cassa_spese.chiusura_id è NOT NULL, quindi non può
-- accoglierle finché la Fase 1 non è stata salvata almeno una volta).
-- Restano qui finché non vengono confermate (spostate in cassa_spese,
-- vedi ChiusuraCassaClient) o eliminate esplicitamente — nessuna scadenza
-- automatica. Stessa forma di RLS di cassa_chiusure (colonna
-- restaurant_id diretta, non tramite join): manager su tutto il
-- proprio locale, cassiere solo sul proprio, nessun vincolo di stato
-- (è solo un appunto, sempre modificabile/cancellabile).
create table public.cassa_spese_bozza (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  data date not null,
  nome_spesa text not null,
  categoria_id uuid references public.cassa_categorie(id),
  importo numeric not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index cassa_spese_bozza_restaurant_data_idx on public.cassa_spese_bozza (restaurant_id, data);

alter table public.cassa_spese_bozza enable row level security;

create policy cassa_spese_bozza_manager_all on public.cassa_spese_bozza
  for all
  using (can_manage_restaurant(restaurant_id))
  with check (can_manage_restaurant(restaurant_id));

create policy cassa_spese_bozza_cassiere_select on public.cassa_spese_bozza
  for select
  using (get_my_role() = 'cassiere' and restaurant_id = get_my_restaurant_id());

create policy cassa_spese_bozza_cassiere_insert on public.cassa_spese_bozza
  for insert
  with check (get_my_role() = 'cassiere' and restaurant_id = get_my_restaurant_id());

create policy cassa_spese_bozza_cassiere_update on public.cassa_spese_bozza
  for update
  using (get_my_role() = 'cassiere' and restaurant_id = get_my_restaurant_id())
  with check (get_my_role() = 'cassiere' and restaurant_id = get_my_restaurant_id());

create policy cassa_spese_bozza_cassiere_delete on public.cassa_spese_bozza
  for delete
  using (get_my_role() = 'cassiere' and restaurant_id = get_my_restaurant_id());
