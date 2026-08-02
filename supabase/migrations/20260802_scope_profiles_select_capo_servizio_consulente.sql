-- profiles_select non applicava alcuno scoping per capo_servizio e
-- consulente_lavoro: qualunque utente con questi ruoli poteva leggere
-- l'intera tabella profiles (nome, contatti, reparto, ecc. di TUTTI i
-- dipendenti di TUTTI i ristoranti, non solo il proprio) — un'esposizione
-- di dati cross-tenant indipendente dall'incidente sulla registrazione.
--
-- Fix: capo_servizio viene scoped al proprio ristorante (get_my_restaurant_id,
-- stesso criterio già applicato lato applicazione in /api/users e nella
-- pagina dipendenti); consulente_lavoro viene scoped ai ristoranti per cui
-- consulta (get_my_consultant_restaurants, già usata altrove per lo stesso
-- scopo). Il ramo manager e "vedi te stesso" restano invariati.
ALTER POLICY profiles_select ON public.profiles
USING (
  (id = auth.uid())
  OR (
    get_my_role() = 'manager' AND (
      (get_my_managed_restaurant_ids() IS NULL AND (role = 'manager' OR restaurant_id IS NULL OR NOT is_demo_restaurant(restaurant_id)))
      OR (get_my_managed_restaurant_ids() IS NOT NULL AND restaurant_id = ANY (get_my_managed_restaurant_ids()))
    )
  )
  OR (get_my_role() = 'capo_servizio' AND restaurant_id = get_my_restaurant_id())
  OR (get_my_role() = 'consulente_lavoro' AND restaurant_id = ANY (get_my_consultant_restaurants()))
);
