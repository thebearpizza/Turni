-- Tre aggiunte alla scansione fatture:
--
-- 1. totale_lordo_manuale / totale_netto_manuale: il totale rilevato
--    dall'OCR non è mai stato scrivibile — un trigger lo ricalcola
--    sempre dalla somma di fatture_articoli/fatture_iva_dettaglio, e
--    qualunque UPDATE diretto verrebbe silenziosamente sovrascritto al
--    prossimo inserimento di una riga figlia. Queste due colonne sono lo
--    "scavalco" che il trigger ora rispetta quando presente: nullo per
--    ogni fattura esistente e per ogni nuova fattura non corretta a
--    mano, quindi comportamento identico a oggi finché non le si usa.
-- 2. vuoti_ritirati: importo opzionale (cauzioni su fusti/casse che il
--    fornitore scala al ritiro dei vuoti) — non tocca il totale
--    scansionato, resta un dato a parte per calcolare "da pagare" in
--    visualizzazione.
alter table public.fatture
  add column totale_lordo_manuale numeric,
  add column totale_netto_manuale numeric,
  add column vuoti_ritirati numeric;

create or replace function public.fatture_recompute_totali(p_fattura_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ha_articoli boolean;
  v_netto numeric;
  v_iva numeric;
  v_netto_manuale numeric;
  v_lordo_manuale numeric;
begin
  select ha_articoli, totale_netto_manuale, totale_lordo_manuale
    into v_ha_articoli, v_netto_manuale, v_lordo_manuale
    from fatture where id = p_fattura_id;
  if v_ha_articoli is null then
    return;
  end if;

  if v_ha_articoli then
    select coalesce(sum(prezzo_riga), 0) into v_netto from fatture_articoli where fattura_id = p_fattura_id;
  else
    select coalesce(sum(imponibile), 0) into v_netto from fatture_iva_dettaglio where fattura_id = p_fattura_id;
  end if;

  select coalesce(sum(iva), 0) into v_iva from fatture_iva_dettaglio where fattura_id = p_fattura_id;

  update fatture
  set
    totale_netto = coalesce(v_netto_manuale, v_netto),
    totale_iva = v_iva,
    totale_lordo = coalesce(v_lordo_manuale, coalesce(v_netto_manuale, v_netto) + v_iva),
    updated_at = now()
  where id = p_fattura_id;
end;
$function$;

-- sostituisci_fattura (ri-scansione): stessa logica di /salva, in più
-- fornisce vuoti_ritirati e i due scavalchi. Gli scavalchi vanno scritti
-- SUL fatture PRIMA di reinserire le righe figlie: il trigger li legge
-- dalla riga fatture nel momento in cui una riga figlia viene inserita,
-- non quando fatture stessa viene aggiornata.
--
-- create or replace non basta da solo: una lista di parametri diversa
-- (anche solo per i 3 nuovi in coda, pur con default) è per Postgres una
-- funzione DIVERSA per overload, non una sostituzione — lascerebbe la
-- vecchia firma a 10 parametri viva accanto alla nuova, rendendo
-- ambigua qualunque chiamata con solo i 10 argomenti originali. Va
-- eliminata esplicitamente.
drop function if exists public.sostituisci_fattura(uuid, uuid, text, date, boolean, uuid, jsonb, jsonb, jsonb, text[]);

create or replace function public.sostituisci_fattura(
  p_fattura_id uuid,
  p_fornitore_id uuid,
  p_numero_documento text,
  p_data date,
  p_ha_articoli boolean,
  p_categoria_spesa_diretta_id uuid,
  p_verifiche_sospette jsonb,
  p_iva_dettaglio jsonb,
  p_articoli jsonb,
  p_foto_paths text[],
  p_totale_lordo_manuale numeric default null,
  p_totale_netto_manuale numeric default null,
  p_vuoti_ritirati numeric default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_restaurant_id uuid;
  v_vecchi_catalogo_ids uuid[];
BEGIN
  SELECT restaurant_id INTO v_restaurant_id FROM fatture WHERE id = p_fattura_id;
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Fattura non trovata';
  END IF;

  IF NOT (
    can_manage_restaurant(v_restaurant_id)
    OR (is_direttore_fatture() AND v_restaurant_id = get_my_restaurant_id())
  ) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  SELECT array_agg(DISTINCT catalogo_articolo_id) INTO v_vecchi_catalogo_ids
  FROM fatture_articoli WHERE fattura_id = p_fattura_id;

  -- Anagrafica + scavalchi PRIMA delle righe figlie (vedi commento sopra).
  UPDATE fatture
  SET fornitore_id = p_fornitore_id,
      numero_documento = p_numero_documento,
      data = p_data,
      ha_articoli = p_ha_articoli,
      categoria_spesa_diretta_id = p_categoria_spesa_diretta_id,
      verifiche_sospette = p_verifiche_sospette,
      foto_paths = p_foto_paths,
      totale_lordo_manuale = p_totale_lordo_manuale,
      totale_netto_manuale = p_totale_netto_manuale,
      vuoti_ritirati = p_vuoti_ritirati,
      updated_by = auth.uid()
  WHERE id = p_fattura_id;

  DELETE FROM fatture_articoli WHERE fattura_id = p_fattura_id;
  DELETE FROM fatture_iva_dettaglio WHERE fattura_id = p_fattura_id;

  INSERT INTO fatture_iva_dettaglio (fattura_id, aliquota, imponibile, iva)
  SELECT p_fattura_id, (r->>'aliquota')::numeric, (r->>'imponibile')::numeric, (r->>'iva')::numeric
  FROM jsonb_array_elements(p_iva_dettaglio) r;

  IF p_ha_articoli THEN
    INSERT INTO fatture_articoli (fattura_id, catalogo_articolo_id, testo_estratto, quantita, prezzo_unitario, prezzo_riga, pagina_indice, riquadro)
    SELECT
      p_fattura_id,
      (r->>'catalogo_articolo_id')::uuid,
      r->>'testo_estratto',
      (r->>'quantita')::numeric,
      CASE WHEN (r->>'quantita')::numeric <> 0 THEN (r->>'prezzo_riga')::numeric / (r->>'quantita')::numeric ELSE (r->>'prezzo_riga')::numeric END,
      (r->>'prezzo_riga')::numeric,
      (r->>'pagina_indice')::smallint,
      r->'riquadro'
    FROM jsonb_array_elements(p_articoli) r;
  END IF;

  IF v_vecchi_catalogo_ids IS NOT NULL THEN
    DELETE FROM articoli_mappature_testo
    WHERE catalogo_articolo_id = ANY(v_vecchi_catalogo_ids)
      AND NOT EXISTS (SELECT 1 FROM fatture_articoli fa WHERE fa.catalogo_articolo_id = articoli_mappature_testo.catalogo_articolo_id);

    DELETE FROM catalogo_articoli
    WHERE id = ANY(v_vecchi_catalogo_ids)
      AND NOT EXISTS (SELECT 1 FROM fatture_articoli fa WHERE fa.catalogo_articolo_id = catalogo_articoli.id);
  END IF;

  -- Se non c'è nessuna riga IVA (fattura senza aliquote) il trigger su
  -- fatture_iva_dettaglio non scatta mai (INSERT di zero righe): forza
  -- comunque un ricalcolo così uno scavalco impostato qui si riflette
  -- sempre, anche in quel caso limite.
  PERFORM fatture_recompute_totali(p_fattura_id);
END;
$function$;
