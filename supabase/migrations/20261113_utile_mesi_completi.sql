-- Mesi di cui il manager ha completato il calcolo dell'utile (spese di
-- gestione inserite, fatture caricate), per locale: solo questi entrano nel
-- resoconto dell'utile in Analisi, così non si leggono margini gonfiati
-- da mesi a cui mancano ancora il personale o le bollette.
create table if not exists public.utile_mesi_completi (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  mese date not null check (extract(day from mese) = 1),
  completato_da uuid default auth.uid() references auth.users(id) on delete set null,
  completato_at timestamptz not null default now(),
  primary key (restaurant_id, mese)
);

alter table public.utile_mesi_completi enable row level security;

create policy utile_mesi_completi_manager on public.utile_mesi_completi
  for all to authenticated
  using (public.can_manage_restaurant(restaurant_id))
  with check (public.can_manage_restaurant(restaurant_id));
