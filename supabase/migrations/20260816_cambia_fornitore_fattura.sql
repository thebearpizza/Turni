-- Cambiare il fornitore di una fattura già caricata (Fatture → Modifica)
-- aggiornava finora solo fatture.fornitore_id: le righe fatture_articoli
-- di quella fattura restavano agganciate a catalogo_articoli ancora
-- intestati al VECCHIO fornitore (catalogo_articoli.fornitore_id è una
-- colonna a sé, non derivata dalla fattura), disallineando sia la tab
-- Articoli che i drill-down dei KPI di Fatture rispetto al fornitore
-- corretto ora sulla fattura.
--
-- Per ogni riga articolo della fattura, questa funzione sposta il prodotto
-- sul nuovo fornitore:
--  - se esiste già un catalogo_articoli con lo stesso nome per il nuovo
--    fornitore, vi si aggancia (evita duplicati);
--  - altrimenti, se il vecchio catalogo_articoli è usato SOLO da questa
--    fattura, lo si sposta direttamente sul nuovo fornitore;
--  - altrimenti (condiviso con altre fatture del vecchio fornitore, che
--    devono restargli intestate) se ne crea uno nuovo per il nuovo
--    fornitore con gli stessi dati.
-- Il vecchio catalogo_articoli che resta senza più nessun acquisto viene
-- ripulito, stesso pattern già usato da elimina_fattura_con_pulizia_articoli.
--
-- Nessun REVOKE esplicito: come elimina_fattura_con_pulizia_articoli, la
-- funzione si autodifende internamente (RAISE EXCEPTION se il chiamante
-- non può gestire il ristorante della fattura), quindi lasciare i
-- privilegi di default concessi da Supabase è sicuro.
CREATE OR REPLACE FUNCTION public.cambia_fornitore_fattura(p_fattura_id uuid, p_nuovo_fornitore_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_restaurant_id uuid;
  v_owner_id uuid;
  v_vecchio_fornitore_id uuid;
  v_riga record;
  v_nuovo_catalogo_id uuid;
BEGIN
  SELECT restaurant_id, fornitore_id INTO v_restaurant_id, v_vecchio_fornitore_id
  FROM fatture WHERE id = p_fattura_id;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Fattura non trovata';
  END IF;

  IF NOT (
    can_manage_restaurant(v_restaurant_id)
    OR (is_direttore_fatture() AND v_restaurant_id = get_my_restaurant_id())
  ) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  IF v_vecchio_fornitore_id = p_nuovo_fornitore_id THEN
    RETURN;
  END IF;

  SELECT owner_id INTO v_owner_id FROM restaurants WHERE id = v_restaurant_id;

  -- Ripetuto esplicitamente il controllo che la RLS in lettura su fornitori
  -- farebbe comunque rispettare in UI: qui la funzione, essendo SECURITY
  -- DEFINER, la bypassa.
  IF NOT EXISTS (SELECT 1 FROM fornitori WHERE id = p_nuovo_fornitore_id AND owner_id = v_owner_id) THEN
    RAISE EXCEPTION 'Fornitore non valido';
  END IF;

  FOR v_riga IN
    SELECT fa.id AS fattura_articolo_id, ca.id AS vecchio_catalogo_id,
           ca.nome_articolo, ca.tipologia, ca.unita_misura, ca.fattore_conversione
    FROM fatture_articoli fa
    JOIN catalogo_articoli ca ON ca.id = fa.catalogo_articolo_id
    WHERE fa.fattura_id = p_fattura_id
  LOOP
    SELECT id INTO v_nuovo_catalogo_id
    FROM catalogo_articoli
    WHERE owner_id = v_owner_id AND fornitore_id = p_nuovo_fornitore_id AND nome_articolo = v_riga.nome_articolo;

    IF v_nuovo_catalogo_id IS NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM fatture_articoli fa2
        WHERE fa2.catalogo_articolo_id = v_riga.vecchio_catalogo_id AND fa2.fattura_id <> p_fattura_id
      ) THEN
        UPDATE catalogo_articoli SET fornitore_id = p_nuovo_fornitore_id WHERE id = v_riga.vecchio_catalogo_id;
        v_nuovo_catalogo_id := v_riga.vecchio_catalogo_id;
      ELSE
        INSERT INTO catalogo_articoli (owner_id, fornitore_id, nome_articolo, tipologia, unita_misura, fattore_conversione)
        VALUES (v_owner_id, p_nuovo_fornitore_id, v_riga.nome_articolo, v_riga.tipologia, v_riga.unita_misura, v_riga.fattore_conversione)
        RETURNING id INTO v_nuovo_catalogo_id;
      END IF;
    END IF;

    IF v_nuovo_catalogo_id <> v_riga.vecchio_catalogo_id THEN
      UPDATE fatture_articoli SET catalogo_articolo_id = v_nuovo_catalogo_id WHERE id = v_riga.fattura_articolo_id;

      IF NOT EXISTS (SELECT 1 FROM fatture_articoli fa3 WHERE fa3.catalogo_articolo_id = v_riga.vecchio_catalogo_id) THEN
        DELETE FROM articoli_mappature_testo WHERE catalogo_articolo_id = v_riga.vecchio_catalogo_id;
        DELETE FROM catalogo_articoli WHERE id = v_riga.vecchio_catalogo_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE fatture SET fornitore_id = p_nuovo_fornitore_id, updated_by = auth.uid() WHERE id = p_fattura_id;
END;
$function$;
