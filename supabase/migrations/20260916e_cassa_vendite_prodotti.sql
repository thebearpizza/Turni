-- Vendite per categoria/prodotto lette dal report di chiusura (Analisi
-- Cassa) — una riga per prodotto per chiusura, non per categoria a
-- parte: il grafico a ciambella già esistente per le spese
-- (CategorieBreakdownChart/CategorieTrendChart) aggrega già da sé per
-- categoria_nome e fa drill-down su nome_spesa — qui basta dargli
-- nome_categoria/nome_prodotto nella stessa forma, senza bisogno di
-- una tabella aggregata separata.
--
-- nome_categoria è NULLABLE: il report non sempre lega esplicitamente
-- ogni prodotto alla sua categoria — quando manca, il grafico lo
-- raggruppa già da solo sotto "Senza categoria" (stessa convenzione
-- già in uso per le spese senza categoria).
--
-- Stesso pattern RLS di cassa_spese: manager pieno accesso, cassiere
-- scoped al proprio locale tramite la chiusura collegata.
create table public.cassa_vendite_prodotti (
  id              uuid primary key default gen_random_uuid(),
  chiusura_id     uuid not null references public.cassa_chiusure(id) on delete cascade,
  nome_categoria  text,
  nome_prodotto   text not null,
  quantita        numeric not null default 0,
  importo         numeric not null default 0,
  valore_lordo    numeric not null default 0,
  created_at      timestamptz not null default now(),
  unique (chiusura_id, nome_prodotto)
);

create index cassa_vendite_prodotti_chiusura_idx on public.cassa_vendite_prodotti (chiusura_id);

alter table public.cassa_vendite_prodotti enable row level security;

create policy cassa_vendite_prodotti_manager_all on public.cassa_vendite_prodotti
  for all
  using (exists (select 1 from cassa_chiusure c where c.id = cassa_vendite_prodotti.chiusura_id and can_manage_restaurant(c.restaurant_id)))
  with check (exists (select 1 from cassa_chiusure c where c.id = cassa_vendite_prodotti.chiusura_id and can_manage_restaurant(c.restaurant_id)));

create policy cassa_vendite_prodotti_select on public.cassa_vendite_prodotti
  for select
  using (exists (
    select 1 from cassa_chiusure c
    where c.id = cassa_vendite_prodotti.chiusura_id
      and (can_manage_restaurant(c.restaurant_id) or (get_my_role() = 'cassiere' and c.restaurant_id = get_my_restaurant_id()))
  ));

create policy cassa_vendite_prodotti_cassiere_insert on public.cassa_vendite_prodotti
  for insert
  with check (exists (select 1 from cassa_chiusure c where c.id = cassa_vendite_prodotti.chiusura_id and get_my_role() = 'cassiere' and c.restaurant_id = get_my_restaurant_id()));

create policy cassa_vendite_prodotti_cassiere_update on public.cassa_vendite_prodotti
  for update
  using (exists (select 1 from cassa_chiusure c where c.id = cassa_vendite_prodotti.chiusura_id and get_my_role() = 'cassiere' and c.restaurant_id = get_my_restaurant_id()))
  with check (exists (select 1 from cassa_chiusure c where c.id = cassa_vendite_prodotti.chiusura_id and get_my_role() = 'cassiere' and c.restaurant_id = get_my_restaurant_id()));

create policy cassa_vendite_prodotti_cassiere_delete on public.cassa_vendite_prodotti
  for delete
  using (exists (select 1 from cassa_chiusure c where c.id = cassa_vendite_prodotti.chiusura_id and get_my_role() = 'cassiere' and c.restaurant_id = get_my_restaurant_id()));
