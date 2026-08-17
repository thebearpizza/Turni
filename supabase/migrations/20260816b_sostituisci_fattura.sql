-- Ri-scansione di una fattura già caricata (Fatture → Visualizza →
-- Ri-scansiona): riparte dalle stesse foto già su storage per una nuova
-- lettura AI, e sostituisce i dati esistenti invece di crearne una fattura
-- doppia — utile quando la prima lettura ha sbagliato fornitore/importi.
--
-- Sostituisce atomicamente le righe articolo/IVA e i campi anagrafici
-- della fattura. Gli eventuali nuovi catalogo_articoli (per articoli
-- 'nuovo' risolti in revisione) sono già creati lato TypeScript prima di
-- chiamare questa funzione — qui arrivano già risolti in p_articoli.
-- Il vecchio catalogo_articoli che resta senza più nessun acquisto dopo
-- la sostituzione viene ripulito, stesso pattern di
-- elimina_fattura_con_pulizia_articoli e cambia_fornitore_fattura.
--
-- Nessun REVOKE esplicito, stesso motivo delle altre due: si autodifende
-- internamente (RAISE EXCEPTION se il chiamante non può gestire il
-- ristorante della fattura).
CREATE OR REPLACE FUNCTION public.sostituisci_fattura(
  p_fattura_id uuid,
  p_fornitore_id uuid,
  p_numero_documento text,
  p_data date,
  p_ha_articoli boolean,
  p_categoria_spesa_diretta_id uuid,
  p_verifiche_sospette jsonb,
  p_iva_dettaglio jsonb,
  p_articoli jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  DELETE FROM fatture_articoli WHERE fattura_id = p_fattura_id;
  DELETE FROM fatture_iva_dettaglio WHERE fattura_id = p_fattura_id;

  INSERT INTO fatture_iva_dettaglio (fattura_id, aliquota, imponibile, iva)
  SELECT p_fattura_id, (r->>'aliquota')::numeric, (r->>'imponibile')::numeric, (r->>'iva')::numeric
  FROM jsonb_array_elements(p_iva_dettaglio) r;

  IF p_ha_articoli THEN
    INSERT INTO fatture_articoli (fattura_id, catalogo_articolo_id, testo_estratto, quantita, prezzo_unitario, prezzo_riga)
    SELECT
      p_fattura_id,
      (r->>'catalogo_articolo_id')::uuid,
      r->>'testo_estratto',
      (r->>'quantita')::numeric,
      CASE WHEN (r->>'quantita')::numeric <> 0 THEN (r->>'prezzo_riga')::numeric / (r->>'quantita')::numeric ELSE (r->>'prezzo_riga')::numeric END,
      (r->>'prezzo_riga')::numeric
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

  UPDATE fatture
  SET fornitore_id = p_fornitore_id,
      numero_documento = p_numero_documento,
      data = p_data,
      ha_articoli = p_ha_articoli,
      categoria_spesa_diretta_id = p_categoria_spesa_diretta_id,
      verifiche_sospette = p_verifiche_sospette,
      updated_by = auth.uid()
  WHERE id = p_fattura_id;
END;
$function$;
