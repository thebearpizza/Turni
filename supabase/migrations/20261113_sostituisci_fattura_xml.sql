-- Una fattura caricata da foto viene sostituita dal suo XML (stesso
-- fornitore e numero) quando si importa il file: la sostituzione deve anche
-- collegare il file XML e conservare l'aliquota IVA di ogni riga, che la
-- versione precedente non scriveva. Cambia la firma: prima il DROP della
-- vecchia, altrimenti CREATE OR REPLACE creerebbe un overload.
drop function if exists public.sostituisci_fattura(uuid, uuid, text, date, boolean, uuid, jsonb, jsonb, jsonb, text[], numeric, numeric, numeric);

create function public.sostituisci_fattura(
  p_fattura_id uuid, p_fornitore_id uuid, p_numero_documento text, p_data date, p_ha_articoli boolean,
  p_categoria_spesa_diretta_id uuid, p_verifiche_sospette jsonb, p_iva_dettaglio jsonb, p_articoli jsonb,
  p_foto_paths text[], p_totale_lordo_manuale numeric default null, p_totale_netto_manuale numeric default null,
  p_vuoti_ritirati numeric default null, p_xml_path text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_restaurant_id uuid;
  v_vecchi_catalogo_ids uuid[];
begin
  select restaurant_id into v_restaurant_id from fatture where id = p_fattura_id;
  if v_restaurant_id is null then
    raise exception 'Fattura non trovata';
  end if;

  if not (
    can_manage_restaurant(v_restaurant_id)
    or (is_direttore_fatture() and v_restaurant_id = get_my_restaurant_id())
  ) then
    raise exception 'Non autorizzato';
  end if;

  select array_agg(distinct catalogo_articolo_id) into v_vecchi_catalogo_ids
  from fatture_articoli where fattura_id = p_fattura_id;

  update fatture
  set fornitore_id = p_fornitore_id,
      numero_documento = p_numero_documento,
      data = p_data,
      ha_articoli = p_ha_articoli,
      categoria_spesa_diretta_id = p_categoria_spesa_diretta_id,
      verifiche_sospette = p_verifiche_sospette,
      foto_paths = p_foto_paths,
      totale_lordo_manuale = p_totale_lordo_manuale,
      totale_netto_manuale = p_totale_netto_manuale,
      vuoti_ritirati = p_vuoti_ritirati,
      xml_path = coalesce(p_xml_path, xml_path),
      updated_by = auth.uid()
  where id = p_fattura_id;

  delete from fatture_articoli where fattura_id = p_fattura_id;
  delete from fatture_iva_dettaglio where fattura_id = p_fattura_id;

  insert into fatture_iva_dettaglio (fattura_id, aliquota, imponibile, iva)
  select p_fattura_id, (r->>'aliquota')::numeric, (r->>'imponibile')::numeric, (r->>'iva')::numeric
  from jsonb_array_elements(p_iva_dettaglio) r;

  if p_ha_articoli then
    insert into fatture_articoli (fattura_id, catalogo_articolo_id, testo_estratto, quantita, prezzo_unitario, prezzo_riga, pagina_indice, riquadro, aliquota_iva)
    select
      p_fattura_id,
      (r->>'catalogo_articolo_id')::uuid,
      r->>'testo_estratto',
      (r->>'quantita')::numeric,
      case when (r->>'quantita')::numeric <> 0 then (r->>'prezzo_riga')::numeric / (r->>'quantita')::numeric else (r->>'prezzo_riga')::numeric end,
      (r->>'prezzo_riga')::numeric,
      (r->>'pagina_indice')::smallint,
      r->'riquadro',
      nullif(r->>'aliquota_iva', '')::numeric
    from jsonb_array_elements(p_articoli) r;
  end if;

  if v_vecchi_catalogo_ids is not null then
    delete from articoli_mappature_testo
    where catalogo_articolo_id = any(v_vecchi_catalogo_ids)
      and not exists (select 1 from fatture_articoli fa where fa.catalogo_articolo_id = articoli_mappature_testo.catalogo_articolo_id);

    delete from catalogo_articoli
    where id = any(v_vecchi_catalogo_ids)
      and not exists (select 1 from fatture_articoli fa where fa.catalogo_articolo_id = catalogo_articoli.id);
  end if;

  perform fatture_recompute_totali(p_fattura_id);
end;
$function$;
