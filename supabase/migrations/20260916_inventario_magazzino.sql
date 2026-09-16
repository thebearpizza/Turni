-- Inventario (Acquisti): giacenze di magazzino per ristorante.
--
-- catalogo_articoli è scoped per owner (condiviso tra tutti i locali di
-- un manager, vedi 20260809_catalogo_articoli_direttore_update.sql), ma
-- la giacenza è per singolo ristorante — da qui la nuova tabella, non un
-- semplice campo su catalogo_articoli.
--
-- traccia_in_inventario è invece owner-wide (un interruttore nella tab
-- Articoli esistente, non per-ristorante): se un manager decide di
-- tracciare la Coca-Cola, la traccia in tutti i suoi locali.
--
-- inventario_movimenti è un registro immutabile (niente UPDATE/DELETE
-- per il direttore, il manager mantiene ALL come ovunque nello schema):
-- ogni carico/scarico è una riga, la giacenza attuale è la somma dei
-- movimenti — per correggere un errore si aggiunge un movimento di
-- rettifica, non si riscrive la storia. Punto di innesto futuro per lo
-- scarico automatico da fatture (vedi salva/route.ts) e da chiusure
-- cassa: entrambi inseriranno righe qui con causale dedicata, senza
-- toccare questo schema.

alter table public.catalogo_articoli
  add column traccia_in_inventario boolean not null default false;

create table public.inventario_movimenti (
  id                     uuid primary key default gen_random_uuid(),
  restaurant_id          uuid not null references public.restaurants(id) on delete cascade,
  catalogo_articolo_id   uuid not null references public.catalogo_articoli(id) on delete cascade,
  -- positiva = carico, negativa = scarico.
  quantita               numeric not null check (quantita <> 0),
  -- 'carico_manuale' | 'scarico_manuale' | 'rettifica' oggi; 'fattura' e
  -- 'chiusura_cassa' quando arriverà lo scarico automatico — stesso
  -- approccio "enum a livello applicativo" già usato per tipologia su
  -- catalogo_articoli, nessun CHECK a livello DB.
  causale                text not null default 'manuale',
  nota                   text,
  created_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now()
);

create index inventario_movimenti_restaurant_articolo_idx
  on public.inventario_movimenti (restaurant_id, catalogo_articolo_id, created_at desc);

alter table public.inventario_movimenti enable row level security;

create policy inventario_movimenti_manager_all on public.inventario_movimenti
  for all
  using (can_manage_restaurant(restaurant_id))
  with check (can_manage_restaurant(restaurant_id));

create policy inventario_movimenti_direttore_select on public.inventario_movimenti
  for select
  using (is_direttore_fatture() and restaurant_id = get_my_restaurant_id());

create policy inventario_movimenti_direttore_insert on public.inventario_movimenti
  for insert
  with check (is_direttore_fatture() and restaurant_id = get_my_restaurant_id());

-- Giacenza attuale = somma dei movimenti per ristorante+articolo. Vista
-- semplice invece di un contatore denormalizzato: i volumi in gioco
-- (articoli tracciati per locale) sono piccoli, non serve la
-- complessità di un trigger di mantenimento — e si evita ogni rischio
-- di disallineamento tra contatore e storico.
create view public.inventario_giacenze
  with (security_invoker = true) as
select
  restaurant_id,
  catalogo_articolo_id,
  sum(quantita) as giacenza,
  max(created_at) as ultimo_movimento_at
from public.inventario_movimenti
group by restaurant_id, catalogo_articolo_id;
