-- Redesign Acquisti (MTAcquisti.dc.html): aliquota IVA per riga, fatture
-- rettificate, scorte minime per locale e rettifica atomica di una riga.
-- Il codice ha un ripiego per ogni punto, che si disattiva da solo ora che
-- la migrazione è applicata.

-- 1) Aliquota IVA per riga articolo. Serve alla rettifica di una riga in
--    Fatture (riquadro teal: "Aliquota IVA" 0/4/5/10/22) e alla revisione
--    della cattura (campo IVA per articolo): con l'aliquota salvata il
--    riepilogo IVA si ricostruisce dalle righe. /salva la scrive già se la
--    colonna esiste (ripiego automatico se manca).
alter table public.fatture_articoli add column if not exists aliquota_iva numeric(5,2);

-- 2) Badge "Rettificata": una fattura già verificata a cui è stata
--    corretta una riga. Oggi il badge vale solo nella sessione corrente.
alter table public.fatture add column if not exists rettificata_at timestamptz;

-- 3) Scorta minima per locale e articolo (colonna "Scorta min." e stati
--    "Sotto scorta" / KPI "Sotto scorta" di Inventario). Senza la tabella
--    la colonna mostra "—" e lo stato è solo Ok / Esaurito.
create table if not exists public.inventario_scorte (
  restaurant_id         uuid not null references public.restaurants(id) on delete cascade,
  catalogo_articolo_id  uuid not null references public.catalogo_articoli(id) on delete cascade,
  scorta_minima         numeric not null check (scorta_minima >= 0),
  updated_at            timestamptz not null default now(),
  primary key (restaurant_id, catalogo_articolo_id)
);
alter table public.inventario_scorte enable row level security;
-- Stesse regole di inventario_movimenti: manager su tutto ciò che gestisce,
-- direttore sul proprio locale.
create policy inventario_scorte_manager_all on public.inventario_scorte
  for all using (can_manage_restaurant(restaurant_id)) with check (can_manage_restaurant(restaurant_id));
create policy inventario_scorte_direttore_all on public.inventario_scorte
  for all using (is_direttore_fatture() and restaurant_id = get_my_restaurant_id())
  with check (is_direttore_fatture() and restaurant_id = get_my_restaurant_id());
-- unisci_articoli è esteso più sotto per spostare anche le scorte.

-- unisci_articoli: stessa firma (nessun overload), in più sposta le scorte
-- minime dall'articolo assorbito a quello mantenuto (tenendo la più alta
-- se entrambi ne hanno una nello stesso locale) prima della cancellazione,
-- che altrimenti le perderebbe in cascata.
CREATE OR REPLACE FUNCTION public.unisci_articoli(p_assorbito_id uuid, p_mantenuto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner_assorbito uuid;
  v_owner_mantenuto uuid;
  v_fornitore_mantenuto uuid;
  v_traccia_assorbito boolean;
begin
  if p_assorbito_id = p_mantenuto_id then
    raise exception 'Impossibile unire un articolo con se stesso';
  end if;

  select owner_id, traccia_in_inventario into v_owner_assorbito, v_traccia_assorbito
  from catalogo_articoli where id = p_assorbito_id;
  select owner_id, fornitore_id into v_owner_mantenuto, v_fornitore_mantenuto
  from catalogo_articoli where id = p_mantenuto_id;

  if v_owner_assorbito is null or v_owner_mantenuto is null then
    raise exception 'Articolo non trovato';
  end if;
  if v_owner_assorbito <> v_owner_mantenuto then
    raise exception 'I due articoli non appartengono allo stesso locale';
  end if;

  if not exists (
    select 1 from restaurants r where r.owner_id = v_owner_assorbito and can_manage_restaurant(r.id)
  ) then
    raise exception 'Non autorizzato';
  end if;

  update fatture_articoli set catalogo_articolo_id = p_mantenuto_id where catalogo_articolo_id = p_assorbito_id;

  update inventario_movimenti set catalogo_articolo_id = p_mantenuto_id where catalogo_articolo_id = p_assorbito_id;

  insert into inventario_scorte (restaurant_id, catalogo_articolo_id, scorta_minima, updated_at)
  select restaurant_id, p_mantenuto_id, scorta_minima, now()
  from inventario_scorte where catalogo_articolo_id = p_assorbito_id
  on conflict (restaurant_id, catalogo_articolo_id)
  do update set scorta_minima = greatest(inventario_scorte.scorta_minima, excluded.scorta_minima), updated_at = now();

  delete from articoli_mappature_testo m1
  where m1.catalogo_articolo_id = p_assorbito_id
    and exists (
      select 1 from articoli_mappature_testo m2
      where m2.owner_id = v_owner_mantenuto and m2.fornitore_id = v_fornitore_mantenuto
        and m2.testo_estratto = m1.testo_estratto
    );
  update articoli_mappature_testo
  set catalogo_articolo_id = p_mantenuto_id, fornitore_id = v_fornitore_mantenuto
  where catalogo_articolo_id = p_assorbito_id;

  if v_traccia_assorbito then
    update catalogo_articoli set traccia_in_inventario = true where id = p_mantenuto_id;
  end if;

  delete from catalogo_articoli where id = p_assorbito_id;
end;
$function$;

-- 4) Rettifica atomica di una riga (quantità, prezzo, aliquota, categoria)
--    con ricalcolo del riepilogo IVA dalle righe. SECURITY DEFINER perché
--    tocca fatture_articoli, fatture_iva_dettaglio, catalogo_articoli e
--    fatture insieme; controllo d'autorizzazione esplicito in testa, come
--    registra_consumo_chiusura. Funzione nuova: nessun DROP necessario.
create or replace function public.rettifica_riga_fattura(
  p_riga_id uuid, p_quantita numeric, p_prezzo_unitario numeric, p_aliquota numeric, p_tipologia text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fattura_id uuid;
  v_restaurant_id uuid;
  v_articolo_id uuid;
  v_vecchia numeric;
begin
  select fa.fattura_id, f.restaurant_id, fa.catalogo_articolo_id, fa.aliquota_iva
    into v_fattura_id, v_restaurant_id, v_articolo_id, v_vecchia
  from fatture_articoli fa join fatture f on f.id = fa.fattura_id
  where fa.id = p_riga_id;
  if v_fattura_id is null then raise exception 'Riga non trovata'; end if;

  if not (
    can_manage_restaurant(v_restaurant_id)
    or (is_direttore_fatture() and v_restaurant_id = get_my_restaurant_id())
  ) then
    raise exception 'Non autorizzato';
  end if;
  if p_quantita is null or p_quantita <= 0 or p_prezzo_unitario is null or p_prezzo_unitario < 0 then
    raise exception 'Quantità o prezzo non validi';
  end if;
  if p_aliquota is not null and p_aliquota not in (0, 4, 5, 10, 22) then
    raise exception 'Aliquota non valida';
  end if;
  if p_tipologia is not null and p_tipologia not in ('food', 'beverage', 'detergenza', 'altro_no_food') then
    raise exception 'Tipologia non valida';
  end if;

  update fatture_articoli
     set quantita = p_quantita,
         prezzo_unitario = p_prezzo_unitario,
         prezzo_riga = round(p_quantita * p_prezzo_unitario, 2),
         aliquota_iva = coalesce(p_aliquota, aliquota_iva)
   where id = p_riga_id;

  if p_tipologia is not null then
    update catalogo_articoli set tipologia = p_tipologia where id = v_articolo_id;
  end if;

  -- Riepilogo IVA ricostruito dalle righe solo se TUTTE hanno l'aliquota:
  -- altrimenti si lascia quello letto in fattura.
  if not exists (select 1 from fatture_articoli where fattura_id = v_fattura_id and aliquota_iva is null) then
    delete from fatture_iva_dettaglio where fattura_id = v_fattura_id;
    insert into fatture_iva_dettaglio (fattura_id, aliquota, imponibile, iva)
    select v_fattura_id, aliquota_iva, round(sum(prezzo_riga), 2), round(sum(prezzo_riga) * aliquota_iva / 100, 2)
      from fatture_articoli where fattura_id = v_fattura_id group by aliquota_iva;
  end if;

  -- Un totale corretto a mano coprirebbe la rettifica.
  update fatture
     set totale_lordo_manuale = null, totale_netto_manuale = null,
         rettificata_at = case when jsonb_array_length(verifiche_sospette) = 0 then now() else rettificata_at end,
         updated_by = auth.uid()
   where id = v_fattura_id;
end;
$function$;
revoke all on function public.rettifica_riga_fattura(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.rettifica_riga_fattura(uuid, numeric, numeric, numeric, text) to authenticated;
