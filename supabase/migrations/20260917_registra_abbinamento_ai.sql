-- Scrittura di una mappatura decisa dall'AI (non da un umano) durante la
-- lettura automatica del report di chiusura — vedi matchProdottiVenduti
-- in reportChiusuraExtraction.ts. Serve una funzione a parte da
-- abbina_prodotto_venduto (quella per la conferma manuale in Inventario)
-- perché questa gira dentro /api/cassa/chiusura/estrai-report, chiamata
-- di norma dal CASSIERE in Fase 1 — un ruolo che non ha alcun accesso a
-- vendite_prodotti_mappature (solo manager/direttore, vedi
-- 20260916f_vendite_prodotti_mappature.sql) e che non deve poter
-- scavalcare mappature decise a mano.
--
-- Per questo qui l'inserimento è ON CONFLICT DO NOTHING (mai un
-- sovrascrive): se esiste già una riga — decisa da un manager/direttore
-- o da una lettura AI precedente — questa chiamata non la tocca. L'AI
-- può solo aggiungere un abbinamento su un nome MAI visto prima, mai
-- correggere una decisione già presa.
create or replace function public.registra_abbinamento_ai(p_restaurant_id uuid, p_nome_prodotto text, p_catalogo_articolo_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from restaurants where id = p_restaurant_id;
  if v_owner_id is null then
    raise exception 'Locale non trovato';
  end if;

  if not (
    can_manage_restaurant(p_restaurant_id)
    or (is_direttore_fatture() and p_restaurant_id = get_my_restaurant_id())
    or (get_my_role() = 'cassiere' and p_restaurant_id = get_my_restaurant_id())
  ) then
    raise exception 'Non autorizzato';
  end if;

  insert into vendite_prodotti_mappature (owner_id, nome_prodotto, catalogo_articolo_id, created_by)
  values (v_owner_id, trim(p_nome_prodotto), p_catalogo_articolo_id, auth.uid())
  on conflict (owner_id, nome_prodotto) do nothing;
end;
$function$;
