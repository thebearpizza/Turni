-- Il direttore poteva già inserire e leggere il catalogo articoli
-- (catalogo_articoli_direttore_insert/select) ma non modificarlo: mancava
-- la policy UPDATE, necessaria ora per lasciargli correggere unità di
-- misura (e fattore di conversione) dalla tab Articoli — stesso identico
-- scoping delle altre due policy del direttore su questa tabella.
create policy catalogo_articoli_direttore_update on public.catalogo_articoli
  for update
  using (
    is_direttore_fatture()
    and exists (
      select 1 from restaurants r
      where r.owner_id = catalogo_articoli.owner_id
        and r.id = get_my_restaurant_id()
    )
  )
  with check (
    is_direttore_fatture()
    and exists (
      select 1 from restaurants r
      where r.owner_id = catalogo_articoli.owner_id
        and r.id = get_my_restaurant_id()
    )
  );
