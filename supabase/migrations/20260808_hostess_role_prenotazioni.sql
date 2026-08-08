-- Nuovo ruolo "hostess", scoped a un solo locale (restaurant_id, stesso
-- meccanismo già usato da cassiere/capo_servizio — non managed_restaurant_ids,
-- che è manager-only e legato a can_manage_restaurant()) e con accesso solo
-- alla tab Prenotazioni. Non serve un enum/CHECK: `profiles.role` è già
-- testo libero applicato solo lato codice, come per gli altri ruoli.

-- Restaurants: l'hostess deve poter leggere il proprio locale (join
-- restaurants(id, name) dentro la query di prenotazioni_insegne). La
-- policy staff_read_restaurants esistente non è già scoped per
-- restaurant_id — nessuno dei ruoli che copre lo è, è una lettura di sola
-- anagrafica — quindi si estende semplicemente l'elenco ruoli invece di
-- introdurre uno scoping che gli altri ruoli non hanno.
DROP POLICY IF EXISTS staff_read_restaurants ON public.restaurants;
CREATE POLICY staff_read_restaurants ON public.restaurants
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['capo_servizio', 'dipendente', 'cassiere', 'hostess']));

-- prenotazioni_insegne: solo le insegne del proprio locale.
CREATE POLICY prenotazioni_insegne_hostess_select ON public.prenotazioni_insegne
  FOR SELECT
  USING (get_my_role() = 'hostess' AND restaurant_id = get_my_restaurant_id());

-- prenotazioni: pieno accesso (crea, modifica stato, cancella) ma solo sul
-- proprio locale — stesso lavoro che farebbe un manager su quell'agenda,
-- non di più.
CREATE POLICY prenotazioni_hostess_all ON public.prenotazioni
  FOR ALL
  USING (get_my_role() = 'hostess' AND restaurant_id = get_my_restaurant_id())
  WITH CHECK (get_my_role() = 'hostess' AND restaurant_id = get_my_restaurant_id());

-- prenotazioni_email_log: solo le voci che riguardano il proprio locale, e
-- solo quelle con `parziale` valorizzato (esito 'incompleta', o già
-- risolta da una di queste — parziale non viene mai svuotato). È
-- esattamente ciò che la tab Prenotazioni usa per la coda: l'hostess non
-- ha bisogno di vedere l'elenco mail generale (quella diagnostica non è
-- nemmeno più esposta in UI), quindi lo scoping tramite il campo JSON è
-- sufficiente — a differenza della policy manager, volutamente non
-- scoped per restaurant_id (scelta preesistente, non toccata qui).
CREATE POLICY prenotazioni_email_log_hostess_select ON public.prenotazioni_email_log
  FOR SELECT
  USING (
    get_my_role() = 'hostess'
    AND (payload -> 'parziale' ->> 'restaurant_id')::uuid = get_my_restaurant_id()
  );

CREATE POLICY prenotazioni_email_log_hostess_update ON public.prenotazioni_email_log
  FOR UPDATE
  USING (
    get_my_role() = 'hostess'
    AND (payload -> 'parziale' ->> 'restaurant_id')::uuid = get_my_restaurant_id()
  )
  WITH CHECK (
    get_my_role() = 'hostess'
    AND (payload -> 'parziale' ->> 'restaurant_id')::uuid = get_my_restaurant_id()
  );
