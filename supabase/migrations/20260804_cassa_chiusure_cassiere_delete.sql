-- Un cassiere non poteva finora eliminare nessuna riga di cassa_chiusure
-- (nessuna policy DELETE per il ruolo cassiere esisteva, solo insert/
-- select/update). Serve per permettergli di eliminare le PROPRIE bozze
-- mai completate dalla nuova UI di ripresa bozze — stesso identico
-- criterio (stato <> 'confermata', proprio ristorante) già usato per
-- cassa_chiusure_cassiere_update, cosi' una chiusura già confermata
-- (record ufficiale) resta eliminabile solo da un manager
-- (cassa_chiusure_manager_all copre già quel caso).
CREATE POLICY cassa_chiusure_cassiere_delete ON public.cassa_chiusure
  FOR DELETE
  USING (
    get_my_role() = 'cassiere'
    AND restaurant_id = get_my_restaurant_id()
    AND stato <> 'confermata'
  );
