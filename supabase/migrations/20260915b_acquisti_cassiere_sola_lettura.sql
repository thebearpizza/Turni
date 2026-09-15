-- Task 2 (Permessi e routing per ruolo): il cassiere ottiene accesso ad
-- Acquisti (Fatture, Articoli, Fornitori) ma SOLO in lettura — nessuna
-- policy INSERT/UPDATE/DELETE per questo ruolo su nessuna delle tabelle
-- coinvolte. Stessa forma delle policy già esistenti per il direttore
-- (is_direttore_fatture()), solo con get_my_role() = 'cassiere' al posto
-- e ristretto a select. Il cassiere è legato a un solo ristorante — stesso
-- perimetro già in vigore per lui altrove in Cassa (Chiusura, Lista
-- Chiusure): su fornitori/catalogo_articoli/categorie_fatture_dirette
-- (entità condivise dall'intero owner, non per-ristorante) vede comunque
-- tutto l'owner del proprio ristorante, esattamente come il direttore.

create policy fornitori_cassiere_select on public.fornitori
  for select
  using (
    get_my_role() = 'cassiere'
    and exists (select 1 from restaurants r where r.owner_id = fornitori.owner_id and r.id = get_my_restaurant_id())
  );

create policy catalogo_articoli_cassiere_select on public.catalogo_articoli
  for select
  using (
    get_my_role() = 'cassiere'
    and exists (select 1 from restaurants r where r.owner_id = catalogo_articoli.owner_id and r.id = get_my_restaurant_id())
  );

create policy categorie_dirette_cassiere_select on public.categorie_fatture_dirette
  for select
  using (
    get_my_role() = 'cassiere'
    and exists (select 1 from restaurants r where r.owner_id = categorie_fatture_dirette.owner_id and r.id = get_my_restaurant_id())
  );

create policy fatture_cassiere_select on public.fatture
  for select
  using (get_my_role() = 'cassiere' and restaurant_id = get_my_restaurant_id());

create policy fatture_articoli_cassiere_select on public.fatture_articoli
  for select
  using (
    get_my_role() = 'cassiere'
    and exists (select 1 from fatture f where f.id = fatture_articoli.fattura_id and f.restaurant_id = get_my_restaurant_id())
  );

create policy fatture_iva_cassiere_select on public.fatture_iva_dettaglio
  for select
  using (
    get_my_role() = 'cassiere'
    and exists (select 1 from fatture f where f.id = fatture_iva_dettaglio.fattura_id and f.restaurant_id = get_my_restaurant_id())
  );
