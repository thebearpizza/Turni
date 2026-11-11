-- Importazione XML: smistamento delle fatture per locale, coda "Da
-- assegnare", conservazione dei file XML ed eliminazione da parte del
-- direttore.
--
-- Idempotente: si può rieseguire senza effetti (if not exists, drop
-- policy if exists prima di create policy, create or replace con la
-- STESSA firma per l'RPC esistente: nessun overload).

-- ── 1. Codice destinatario e riferimenti per locale ───────────────────
-- Più locali possono condividere lo stesso codice (es. Dazio e Crunch
-- Talenti): niente UNIQUE. I riferimenti sono parole/indirizzi che
-- compaiono nelle fatture di quel locale (destinazione, righe…) e servono
-- a distinguerli quando il codice è condiviso; un indirizzo PEC fra i
-- riferimenti vale come PECDestinatario.
alter table public.restaurants add column if not exists codice_destinatario text;
alter table public.restaurants add column if not exists riferimenti_fatture text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_codice_destinatario_formato') then
    alter table public.restaurants
      add constraint restaurants_codice_destinatario_formato
      check (codice_destinatario is null or codice_destinatario ~ '^[A-Z0-9]{7}$');
  end if;
end $$;

-- ── 2. Percorso del file XML conservato ───────────────────────────────
alter table public.fatture add column if not exists xml_path text;
create index if not exists fatture_xml_path_idx on public.fatture (xml_path) where xml_path is not null;

-- ── 2b. Tipologia proposta dall'IA da controllare ─────────────────────
-- Gli articoli nuovi creati dall'import XML hanno la tipologia proposta
-- dall'IA: restano segnati finché l'utente non la conferma o la cambia
-- (Articoli, revisione dell'import).
alter table public.catalogo_articoli add column if not exists tipologia_da_controllare boolean not null default false;

-- ── 3. Coda delle fatture XML da assegnare a un locale ────────────────
-- fatture.restaurant_id è obbligatorio: una fattura di cui non si capisce
-- il locale aspetta qui (dati letti in jsonb, XML nello storage) finché
-- l'utente non sceglie il locale; allora diventa una fattura normale e
-- la riga sparisce. restaurant_ids = locali candidati (quelli gestiti da
-- chi ha importato, o quelli che condividono il codice destinatario):
-- servono alla RLS, non vincolano la scelta finale.
create table if not exists public.fatture_xml_in_attesa (
  id uuid primary key default gen_random_uuid(),
  restaurant_ids uuid[] not null,
  fornitore text not null,
  partita_iva text,
  numero_documento text not null,
  data date not null,
  totale numeric(12,2),
  motivo text,
  file_nome text,
  xml_path text,
  dati jsonb not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Stesso documento importato due volte (es. lo ZIP del mese ricaricato):
-- resta una sola voce in coda.
create unique index if not exists fatture_xml_in_attesa_documento_uq
  on public.fatture_xml_in_attesa (coalesce(partita_iva, lower(fornitore)), numero_documento, data);

alter table public.fatture_xml_in_attesa enable row level security;

grant select, insert, delete on public.fatture_xml_in_attesa to authenticated;

-- Visibile/eliminabile dal manager che gestisce almeno uno dei locali
-- candidati (can_manage_restaurant controlla già ruolo e perimetro).
drop policy if exists fatture_xml_in_attesa_select on public.fatture_xml_in_attesa;
create policy fatture_xml_in_attesa_select on public.fatture_xml_in_attesa
  for select to authenticated
  using (exists (select 1 from unnest(restaurant_ids) c(id) where public.can_manage_restaurant(c.id)));

-- Si inserisce solo a nome proprio e solo con locali tutti gestiti.
drop policy if exists fatture_xml_in_attesa_insert on public.fatture_xml_in_attesa;
create policy fatture_xml_in_attesa_insert on public.fatture_xml_in_attesa
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and cardinality(restaurant_ids) > 0
    and not exists (select 1 from unnest(restaurant_ids) c(id) where not public.can_manage_restaurant(c.id))
  );

drop policy if exists fatture_xml_in_attesa_delete on public.fatture_xml_in_attesa;
create policy fatture_xml_in_attesa_delete on public.fatture_xml_in_attesa
  for delete to authenticated
  using (exists (select 1 from unnest(restaurant_ids) c(id) where public.can_manage_restaurant(c.id)));

-- ── 4. Bucket privato dei file XML ────────────────────────────────────
-- Cartelle: <restaurant_id>/… per le fatture assegnate, coda/… per
-- quelle in attesa. Nelle sottoquery la colonna è sempre qualificata
-- (storage.objects.name): restaurants ha anch'essa una colonna "name".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fatture_xml', 'fatture_xml', false, 5242880, array['application/xml', 'text/xml'])
on conflict (id) do nothing;

drop policy if exists fatture_xml_insert on storage.objects;
create policy fatture_xml_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fatture_xml' and (
      exists (
        select 1 from public.restaurants r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and (public.can_manage_restaurant(r.id) or (public.is_direttore_fatture() and r.id = public.get_my_restaurant_id()))
      )
      or ((storage.foldername(storage.objects.name))[1] = 'coda' and public.get_my_role() = 'manager')
    )
  );

-- Lettura: chi gestisce il locale della cartella, chi vede la fattura che
-- punta al file (RLS di fatture) o la voce in coda (RLS della coda).
drop policy if exists fatture_xml_select on storage.objects;
create policy fatture_xml_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fatture_xml' and (
      exists (
        select 1 from public.restaurants r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and (public.can_manage_restaurant(r.id) or (public.is_direttore_fatture() and r.id = public.get_my_restaurant_id()))
      )
      or exists (select 1 from public.fatture f where f.xml_path = storage.objects.name)
      or exists (select 1 from public.fatture_xml_in_attesa q where q.xml_path = storage.objects.name)
      or ((storage.foldername(storage.objects.name))[1] = 'coda' and storage.objects.owner_id = auth.uid()::text)
    )
  );

-- Eliminazione: file del proprio locale, file di una voce in coda
-- visibile, o il proprio caricamento in coda rimasto senza voce.
drop policy if exists fatture_xml_delete on storage.objects;
create policy fatture_xml_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fatture_xml' and (
      exists (
        select 1 from public.restaurants r
        where r.id::text = (storage.foldername(storage.objects.name))[1]
          and (public.can_manage_restaurant(r.id) or (public.is_direttore_fatture() and r.id = public.get_my_restaurant_id()))
      )
      or exists (select 1 from public.fatture_xml_in_attesa q where q.xml_path = storage.objects.name)
      or ((storage.foldername(storage.objects.name))[1] = 'coda' and storage.objects.owner_id = auth.uid()::text)
    )
  );

-- ── 5. Anche il direttore elimina le fatture del proprio locale ───────
-- Stessa firma (p_fattura_id uuid): create or replace sostituisce, non
-- crea un overload. Corpo identico a prima tranne l'autorizzazione.
create or replace function public.elimina_fattura_con_pulizia_articoli(p_fattura_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_restaurant_id uuid; v_articolo_ids uuid[];
begin
  select restaurant_id into v_restaurant_id from fatture where id = p_fattura_id;
  if v_restaurant_id is null then raise exception 'Fattura non trovata'; end if;
  if not (
    can_manage_restaurant(v_restaurant_id)
    or (is_direttore_fatture() and v_restaurant_id = get_my_restaurant_id())
  ) then raise exception 'Non autorizzato'; end if;
  select array_agg(distinct catalogo_articolo_id) into v_articolo_ids from fatture_articoli where fattura_id = p_fattura_id;
  delete from fatture where id = p_fattura_id;
  if v_articolo_ids is not null then
    delete from articoli_mappature_testo where catalogo_articolo_id = any(v_articolo_ids) and not exists (select 1 from fatture_articoli fa where fa.catalogo_articolo_id = articoli_mappature_testo.catalogo_articolo_id);
    delete from catalogo_articoli where id = any(v_articolo_ids) and not exists (select 1 from fatture_articoli fa where fa.catalogo_articolo_id = catalogo_articoli.id);
  end if;
end;
$function$;
