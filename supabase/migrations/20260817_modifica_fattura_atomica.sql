-- cambia_fornitore_fattura veniva chiamata come primo di DUE passaggi
-- separati (poi un update diretto per numero_documento/data/categoria):
-- lo stato INTERMEDIO che ne risultava — nuovo fornitore ma numero
-- documento ancora quello vecchio — poteva violare da solo il vincolo
-- unique(fornitore_id, numero_documento) anche quando lo stato FINALE
-- (nuovo fornitore + nuovo numero, entrambi scelti dall'utente nello
-- stesso salvataggio) sarebbe stato perfettamente valido: da qui il falso
-- "esiste già" segnalato anche inserendo un numero documento mai usato.
-- Estesa per aggiornare tutti i campi anagrafici in un solo UPDATE finale,
-- così il vincolo si controlla una volta sola sullo stato che conta
-- davvero, quello con cui l'utente ha effettivamente confermato.
DROP FUNCTION IF EXISTS public.cambia_fornitore_fattura(uuid, uuid);

CREATE OR REPLACE FUNCTION public.cambia_fornitore_fattura(
  p_fattura_id uuid,
  p_nuovo_fornitore_id uuid,
  p_numero_documento text,
  p_data date,
  p_categoria_spesa_diretta_id uuid
)
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

  -- Riaggancio dei prodotti al nuovo fornitore — solo se è davvero
  -- cambiato: se è lo stesso di prima, per ogni articolo il catalogo
  -- "esistente per il nuovo fornitore" trovato sotto è semplicemente
  -- quello già in uso, e il blocco di riassegnazione si salta da sé
  -- (v_nuovo_catalogo_id = v_riga.vecchio_catalogo_id), ma evitare il
  -- giro di query quando non serve resta più pulito.
  IF p_nuovo_fornitore_id <> v_vecchio_fornitore_id THEN
    SELECT owner_id INTO v_owner_id FROM restaurants WHERE id = v_restaurant_id;

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
  END IF;

  UPDATE fatture
  SET fornitore_id = p_nuovo_fornitore_id,
      numero_documento = p_numero_documento,
      data = p_data,
      categoria_spesa_diretta_id = p_categoria_spesa_diretta_id,
      updated_by = auth.uid()
  WHERE id = p_fattura_id;
END;
$function$;
