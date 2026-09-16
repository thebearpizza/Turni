-- Risolve il problema per cui i nomi prodotto letti dal report di
-- chiusura quasi mai coincidono esattamente con i nomi tracciati in
-- Inventario (99% dei casi, per stima dell'utente): stesso pattern già
-- in uso per l'abbinamento OCR fatture (articoli_mappature_testo) — un
-- manager/direttore abbina il nome una volta sola, da lì in poi
-- registra_consumo_chiusura lo riconosce da sé. Qui non c'è un
-- fornitore di mezzo (i prodotti del report non ne hanno uno), quindi
-- la mappatura è owner-wide senza fornitore_id, a differenza di
-- articoli_mappature_testo.
--
-- catalogo_articolo_id NULLABLE: significa "prodotto rivisto e
-- confermato come NON un articolo di magazzino" (es. la maggior parte
-- dei piatti del menu) — una decisione esplicita e persistente, per non
-- dover ignorare lo stesso piatto ogni singolo giorno. Non è "non ancora
-- deciso": quello stato non viene salvato da nessuna parte, si ricalcola
-- ogni volta confrontando cassa_vendite_prodotti con questa tabella e
-- con catalogo_articoli (vedi la card "Prodotti da abbinare" in
-- Inventario).
--
-- on delete cascade su catalogo_articolo_id: se l'articolo abbinato
-- viene eliminato (es. assorbito da unisci_articoli), la mappatura
-- decade e il prodotto ricompare da abbinare — non tocco unisci_articoli
-- per spostarla sul nuovo articolo, un minor caso limite che richiede
-- al più un nuovo click, non una perdita di dati.
create table public.vendite_prodotti_mappature (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles(id),
  nome_prodotto         text not null,
  catalogo_articolo_id  uuid references public.catalogo_articoli(id) on delete cascade,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  unique (owner_id, nome_prodotto)
);

alter table public.vendite_prodotti_mappature enable row level security;

-- Stesso schema di autorizzazione di catalogo_articoli/articoli_mappature_testo:
-- owner-wide via join su restaurants, manager pieno accesso, direttore
-- sola lettura (le scritture passano sempre da abbina_prodotto_venduto,
-- SECURITY DEFINER, non da qui).
create policy vendite_prodotti_mappature_manager_all on public.vendite_prodotti_mappature
  for all
  using (exists (select 1 from restaurants r where r.owner_id = vendite_prodotti_mappature.owner_id and can_manage_restaurant(r.id)))
  with check (exists (select 1 from restaurants r where r.owner_id = vendite_prodotti_mappature.owner_id and can_manage_restaurant(r.id)));

create policy vendite_prodotti_mappature_direttore_select on public.vendite_prodotti_mappature
  for select
  using (is_direttore_fatture() and exists (select 1 from restaurants r where r.owner_id = vendite_prodotti_mappature.owner_id and r.id = get_my_restaurant_id()));

-- Il direttore non aveva alcuna policy su cassa_vendite_prodotti (solo
-- manager e cassiere, ereditate da cassa_spese): serve in lettura per
-- calcolare lato client, nella card "Prodotti da abbinare" di
-- Inventario, quali nomi prodotto non sono ancora né un match esatto né
-- una mappatura salvata.
create policy cassa_vendite_prodotti_direttore_select on public.cassa_vendite_prodotti
  for select
  using (exists (
    select 1 from cassa_chiusure c
    where c.id = cassa_vendite_prodotti.chiusura_id
      and is_direttore_fatture() and c.restaurant_id = get_my_restaurant_id()
  ));

-- Scrive/aggiorna una mappatura (o la marca "non è un articolo di
-- magazzino" con p_catalogo_articolo_id null). SECURITY DEFINER perché
-- la tabella non ha una policy di insert diretta per il direttore —
-- stesso motivo, e stesso controllo di autorizzazione esplicito, di
-- registra_consumo_chiusura.
create or replace function public.abbina_prodotto_venduto(p_restaurant_id uuid, p_nome_prodotto text, p_catalogo_articolo_id uuid default null)
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
  ) then
    raise exception 'Non autorizzato';
  end if;

  insert into vendite_prodotti_mappature (owner_id, nome_prodotto, catalogo_articolo_id, created_by)
  values (v_owner_id, trim(p_nome_prodotto), p_catalogo_articolo_id, auth.uid())
  on conflict (owner_id, nome_prodotto) do update
    set catalogo_articolo_id = excluded.catalogo_articolo_id,
        created_by = excluded.created_by,
        created_at = now();
end;
$function$;

-- registra_consumo_chiusura: aggiunge un secondo tentativo di
-- abbinamento (la mappatura salvata) quando il nome non coincide
-- esattamente con nessun articolo tracciato — stessa firma, nessun
-- drop necessario.
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

    -- Nessun match esatto: prova la mappatura imparata (vedi
    -- vendite_prodotti_mappature). Se la mappatura esiste ma è
    -- esplicitamente "non è un articolo di magazzino" (colonna null),
    -- v_articolo_id resta null e il prodotto viene comunque ignorato
    -- sotto — stesso esito di un nome mai visto, senza bisogno di un
    -- ramo a parte.
    if v_articolo_id is null then
      select catalogo_articolo_id into v_articolo_id
      from vendite_prodotti_mappature
      where owner_id = v_owner_id and lower(trim(nome_prodotto)) = lower(trim(r.nome));
    end if;

    if v_articolo_id is not null then
      insert into inventario_movimenti (restaurant_id, catalogo_articolo_id, quantita, causale, nota, created_by)
      values (p_restaurant_id, v_articolo_id, -abs(r.quantita), 'chiusura_cassa', v_nota, auth.uid());
    end if;
  end loop;
end;
$function$;
