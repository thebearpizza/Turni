-- Import del report di chiusura (foto/PDF) in Fase 1 di Chiusura Cassa:
-- bucket per i documenti caricati (non conservati dopo la lettura, a
-- differenza delle foto fattura — cassa_chiusure non ha una colonna
-- foto_paths, il report non è un documento fiscale da poter riaprire),
-- e la funzione che scarica silenziosamente gli articoli venduti
-- dall'Inventario ("al cassiere non interessa").

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chiusura_report_foto', 'chiusura_report_foto', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do nothing;

-- Stesso pattern di fatture_foto (storage.foldername(name)[1] = restaurant_id),
-- ma qui il cassiere carica normalmente (non solo manager/direttore) —
-- coerente con chi usa davvero Chiusura Cassa.
create policy chiusura_report_foto_manager_all on storage.objects
  for all
  using (bucket_id = 'chiusura_report_foto' and can_manage_restaurant(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'chiusura_report_foto' and can_manage_restaurant(((storage.foldername(name))[1])::uuid));

create policy chiusura_report_foto_cassiere_insert on storage.objects
  for insert
  with check (bucket_id = 'chiusura_report_foto' and get_my_role() = 'cassiere' and ((storage.foldername(name))[1])::uuid = get_my_restaurant_id());

create policy chiusura_report_foto_cassiere_read on storage.objects
  for select
  using (bucket_id = 'chiusura_report_foto' and get_my_role() = 'cassiere' and ((storage.foldername(name))[1])::uuid = get_my_restaurant_id());

create policy chiusura_report_foto_cassiere_delete on storage.objects
  for delete
  using (bucket_id = 'chiusura_report_foto' and get_my_role() = 'cassiere' and ((storage.foldername(name))[1])::uuid = get_my_restaurant_id());

-- Scarico automatico dall'Inventario in base ai prodotti venduti letti
-- dal report — SECURITY DEFINER perché il cassiere (che usa Chiusura
-- Cassa) non ha alcun accesso RLS a catalogo_articoli/inventario_movimenti
-- oggi: sia l'abbinamento nome→articolo sia la scrittura del movimento
-- devono avvenire qui dentro, non lato client.
--
-- Abbinamento per nome esatto (stesso criterio già scelto per
-- l'accorpamento in Inventario, vedi InventarioClient.tsx): un prodotto
-- del report che non coincide esattamente con nessun articolo tracciato
-- viene ignorato in silenzio — è il caso atteso per la maggior parte dei
-- piatti del menu, non un errore.
--
-- Idempotente per data: se lo stesso report viene ri-elaborato per la
-- stessa chiusura (es. ricaricato per errore), non raddoppia lo scarico.
create or replace function public.registra_consumo_chiusura(p_restaurant_id uuid, p_data date, p_prodotti jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_id uuid;
  v_nota text;
  v_articolo_id uuid;
  r record;
begin
  select owner_id into v_owner_id from restaurants where id = p_restaurant_id;
  if v_owner_id is null then
    raise exception 'Locale non trovato';
  end if;

  if not (
    can_manage_restaurant(p_restaurant_id)
    or (get_my_role() = 'cassiere' and p_restaurant_id = get_my_restaurant_id())
  ) then
    raise exception 'Non autorizzato';
  end if;

  v_nota := 'Chiusura cassa del ' || to_char(p_data, 'DD/MM/YYYY');

  if exists (
    select 1 from inventario_movimenti
    where restaurant_id = p_restaurant_id and causale = 'chiusura_cassa' and nota = v_nota
  ) then
    return;
  end if;

  for r in select * from jsonb_to_recordset(p_prodotti) as x(nome text, quantita numeric)
  loop
    if r.nome is null or r.quantita is null or r.quantita = 0 then
      continue;
    end if;

    select id into v_articolo_id
    from catalogo_articoli
    where owner_id = v_owner_id
      and traccia_in_inventario = true
      and lower(trim(nome_articolo)) = lower(trim(r.nome))
    order by id
    limit 1;

    if v_articolo_id is not null then
      insert into inventario_movimenti (restaurant_id, catalogo_articolo_id, quantita, causale, nota, created_by)
      values (p_restaurant_id, v_articolo_id, -abs(r.quantita), 'chiusura_cassa', v_nota, auth.uid());
    end if;
  end loop;
end;
$function$;
