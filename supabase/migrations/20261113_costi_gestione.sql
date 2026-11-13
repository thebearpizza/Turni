-- Spese di gestione inserite a mano dal manager (personale, affitto,
-- utenze, marketing...): con incassi, fatture e spese in contanti danno
-- l'utile operativo del mese in Cassa → Utile.
--
-- Importo al netto dell'IVA, come le fatture nel conto economico. Una voce
-- può valere per un solo mese o ripetersi ogni mese (ricorrente) da
-- mese_da fino a mese_a compreso (null = senza fine). Se riguarda più
-- locali (es. il commercialista di tutti) l'importo si divide in parti
-- uguali fra restaurant_ids.
create table if not exists public.costi_gestione (
  id uuid primary key default gen_random_uuid(),
  restaurant_ids uuid[] not null check (cardinality(restaurant_ids) > 0),
  categoria text not null check (categoria in (
    'personale', 'affitto', 'utenze', 'marketing', 'manutenzioni', 'consulenze',
    'assicurazioni', 'commissioni', 'noleggi', 'altro'
  )),
  descrizione text,
  importo numeric(12, 2) not null check (importo >= 0),
  ricorrente boolean not null default false,
  mese_da date not null check (extract(day from mese_da) = 1),
  mese_a date check (mese_a is null or (extract(day from mese_a) = 1 and mese_a >= mese_da)),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists costi_gestione_mesi on public.costi_gestione (mese_da, mese_a);
create index if not exists costi_gestione_locali on public.costi_gestione using gin (restaurant_ids);

alter table public.costi_gestione enable row level security;

-- Solo i manager che gestiscono TUTTI i locali della voce: una spesa
-- condivisa non è visibile (né modificabile) da chi ne vede solo una parte.
create policy costi_gestione_manager on public.costi_gestione
  for all to authenticated
  using (not exists (select 1 from unnest(restaurant_ids) r(id) where not public.can_manage_restaurant(r.id)))
  with check (not exists (select 1 from unnest(restaurant_ids) r(id) where not public.can_manage_restaurant(r.id)));

create trigger costi_gestione_updated_at before update on public.costi_gestione
  for each row execute function public.set_updated_at();
