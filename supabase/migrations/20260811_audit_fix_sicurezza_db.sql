-- Due correzioni emerse dall'audit completo dell'11/08/2026.

-- 1) cassa_spese_recalc_totale gira SECURITY INVOKER: quando il cassiere
-- inserisce/elimina una spesa su una chiusura già confermata (permesso dalla
-- migration 20260809_cassa_spese_cassiere_confermata.sql), l'UPDATE su
-- cassa_chiusure dentro il trigger è soggetto alle stesse RLS del cassiere,
-- la cui policy di UPDATE richiede stato <> 'confermata': l'update non
-- tocca nessuna riga, senza errore, e totale_spese_giornaliere resta
-- silenziosamente disallineato dalla somma reale delle spese. Rendendola
-- SECURITY DEFINER il ricalcolo del campo derivato non passa più dalle
-- policy di scrittura di chi ha causato il trigger.
CREATE OR REPLACE FUNCTION public.cassa_spese_recalc_totale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE cassa_chiusure
    SET totale_spese_giornaliere = COALESCE((SELECT SUM(importo) FROM cassa_spese WHERE chiusura_id = OLD.chiusura_id), 0)
    WHERE id = OLD.chiusura_id;
    RETURN OLD;
  END IF;

  UPDATE cassa_chiusure
  SET totale_spese_giornaliere = COALESCE((SELECT SUM(importo) FROM cassa_spese WHERE chiusura_id = NEW.chiusura_id), 0)
  WHERE id = NEW.chiusura_id;

  IF TG_OP = 'UPDATE' AND OLD.chiusura_id IS DISTINCT FROM NEW.chiusura_id THEN
    UPDATE cassa_chiusure
    SET totale_spese_giornaliere = COALESCE((SELECT SUM(importo) FROM cassa_spese WHERE chiusura_id = OLD.chiusura_id), 0)
    WHERE id = OLD.chiusura_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Riallineamento una tantum: nessuna riga risultava già disallineata al
-- momento dell'audit, ma la funzione va comunque rieseguita per sicurezza
-- prima che il trigger corretto prenda il sopravvento.
UPDATE cassa_chiusure cc
SET totale_spese_giornaliere = COALESCE((SELECT SUM(importo) FROM cassa_spese WHERE chiusura_id = cc.id), 0)
WHERE totale_spese_giornaliere IS DISTINCT FROM COALESCE((SELECT SUM(importo) FROM cassa_spese WHERE chiusura_id = cc.id), 0);

-- 2) close_stale_shifts() è SECURITY DEFINER, scrive su attendances (chiude
-- timbrature dimenticate) e non ha alcun controllo di autorizzazione al suo
-- interno: l'unico chiamante legittimo è il cron interno (pg_cron gira come
-- postgres, non coperto da queste revoke), ma la funzione restava comunque
-- eseguibile via /rest/v1/rpc/close_stale_shifts da anon e authenticated.
REVOKE EXECUTE ON FUNCTION public.close_stale_shifts() FROM anon, authenticated;
