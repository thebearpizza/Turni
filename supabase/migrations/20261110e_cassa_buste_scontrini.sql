-- ════════════════════════════════════════════════════════════════════
-- Migrazione: area CASSA (redesign MTCassa / Chiusura Tablet v2)
-- Il codice funziona già senza: degrada con eleganza finché non c'è.
-- Dopo l'applicazione: controllare l'advisor di sicurezza (AGENTS.md).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Buste di versamento (Cassa › Buste) ─────────────────────────────
-- Il design numera le buste con un progressivo unico ("N° 1284") e le
-- segna "In cassaforte" finché il manager non tocca "Segna come versata in
-- banca". Oggi il numero è calcolato lato client (posizione della chiusura
-- confermata in ordine di data) e lo stato "versata" non esiste: tutte le
-- buste risultano "In cassaforte" e il pulsante avvisa che serve questa
-- migrazione.
alter table public.cassa_chiusure
  add column if not exists busta_numero bigint,
  add column if not exists busta_versata_at timestamptz,
  add column if not exists busta_versata_da uuid references public.profiles(id) on delete set null;

create sequence if not exists public.cassa_busta_numero_seq;

-- Numerazione retroattiva delle chiusure già confermate (in ordine di
-- data, poi di creazione), poi la sequenza riparte dall'ultimo numero.
with ordinate as (
  select id, row_number() over (order by data, created_at, id) as n
  from public.cassa_chiusure
  where stato = 'confermata' and busta_numero is null
)
update public.cassa_chiusure c set busta_numero = o.n from ordinate o where o.id = c.id;
select setval('public.cassa_busta_numero_seq', coalesce((select max(busta_numero) from public.cassa_chiusure), 0) + 1, false);

-- Nessuna busta viene segnata come versata d'ufficio: il gestore ha
-- deciso che non c'è una scadenza (il tema si riprende più avanti).

-- Il numero si assegna alla prima conferma (bozza → confermata) e non
-- cambia più, nemmeno se la chiusura viene modificata.
create or replace function public.cassa_assegna_busta()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.stato = 'confermata' and new.busta_numero is null then
    new.busta_numero := nextval('public.cassa_busta_numero_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists cassa_assegna_busta on public.cassa_chiusure;
create trigger cassa_assegna_busta
  before insert or update of stato on public.cassa_chiusure
  for each row execute function public.cassa_assegna_busta();

-- "Segna come versata" passa dall'UPDATE già consentito al manager dalla
-- RLS di cassa_chiusure (nessuna RPC necessaria). Il cassiere non deve
-- poter toccare queste colonne: se la sua policy di UPDATE lo permette,
-- aggiungere un controllo nel trigger:
create or replace function public.cassa_blocca_busta_cassiere()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if get_my_role() = 'cassiere'
     and (new.busta_versata_at is distinct from old.busta_versata_at
          or new.busta_versata_da is distinct from old.busta_versata_da
          or new.busta_numero is distinct from old.busta_numero) then
    raise exception 'Solo un manager può segnare una busta come versata';
  end if;
  return new;
end;
$$;

drop trigger if exists cassa_blocca_busta_cassiere on public.cassa_chiusure;
create trigger cassa_blocca_busta_cassiere
  before update on public.cassa_chiusure
  for each row execute function public.cassa_blocca_busta_cassiere();


-- ── 2. Foto dello scontrino sulle spese ("Allega foto scontrino") ──────
-- Il codice carica già la foto nel bucket e prova a salvarne il percorso;
-- senza la colonna ripete l'inserimento senza foto e lo segnala.
alter table public.cassa_spese       add column if not exists foto_path text;
alter table public.cassa_spese_bozza add column if not exists foto_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cassa_scontrini', 'cassa_scontrini', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

-- Stesso schema di chiusura_report_foto: prima cartella = restaurant_id.
create policy cassa_scontrini_manager_all on storage.objects
  for all
  using (bucket_id = 'cassa_scontrini' and can_manage_restaurant(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'cassa_scontrini' and can_manage_restaurant(((storage.foldername(name))[1])::uuid));

create policy cassa_scontrini_cassiere_insert on storage.objects
  for insert
  with check (bucket_id = 'cassa_scontrini' and get_my_role() = 'cassiere' and ((storage.foldername(name))[1])::uuid = get_my_restaurant_id());

create policy cassa_scontrini_cassiere_read on storage.objects
  for select
  using (bucket_id = 'cassa_scontrini' and get_my_role() = 'cassiere' and ((storage.foldername(name))[1])::uuid = get_my_restaurant_id());


-- ── 3. Lettura delle richieste di modifica da parte del cassiere ──────
-- Non serve: la policy cassa_chiusure_modifiche_select già esistente
-- permette al cassiere di leggere le richieste del proprio locale.

-- ── 4. Approvazione atomica di una modifica (consigliata) ─────────────
-- Il payload di cassa_chiusure_modifiche ora può contenere, oltre ai campi
-- numerici, le chiavi "_spese" ({modifica:[{id,importo}], elimina:[id],
-- aggiungi:[{nome_spesa,categoria_id,importo}]}) e "_motivo" (testo).
-- Oggi /api/cassa/modifica-approve applica tutto in sequenza con il client
-- del manager (RLS). Questa RPC lo rende atomico; quando c'è, la route può
-- chiamarla al posto della sequenza.
create or replace function public.approva_modifica_chiusura(p_modifica_id uuid, p_approva boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m record;
  c record;
  s jsonb;
  x jsonb;
begin
  select * into m from cassa_chiusure_modifiche where id = p_modifica_id for update;
  if m is null then raise exception 'Richiesta non trovata'; end if;
  select * into c from cassa_chiusure where id = m.chiusura_id;
  -- Controllo di autorizzazione esplicito (stesso pattern di registra_consumo_chiusura).
  if get_my_role() <> 'manager' or not can_manage_restaurant(c.restaurant_id) then
    raise exception 'Non autorizzato';
  end if;
  if m.stato <> 'in_attesa' then raise exception 'Richiesta già gestita'; end if;

  if p_approva then
    update cassa_chiusure set
      fondo_cassa_iniziale = coalesce((m.payload->>'fondo_cassa_iniziale')::numeric, fondo_cassa_iniziale),
      entrate_contanti     = coalesce((m.payload->>'entrate_contanti')::numeric, entrate_contanti),
      entrate_pos          = coalesce((m.payload->>'entrate_pos')::numeric, entrate_pos),
      entrate_bonifico     = coalesce((m.payload->>'entrate_bonifico')::numeric, entrate_bonifico),
      coperti              = coalesce((m.payload->>'coperti')::numeric, coperti),
      incasso_asporto      = coalesce((m.payload->>'incasso_asporto')::numeric, incasso_asporto),
      fondo_cassa_finale   = coalesce((m.payload->>'fondo_cassa_finale')::numeric, fondo_cassa_finale),
      contanti_per_banca   = coalesce((m.payload->>'contanti_per_banca')::numeric, contanti_per_banca),
      updated_by = auth.uid()
    where id = c.id;

    s := m.payload->'_spese';
    if s is not null then
      for x in select * from jsonb_array_elements(coalesce(s->'modifica', '[]'::jsonb)) loop
        update cassa_spese set importo = (x->>'importo')::numeric where id = (x->>'id')::uuid and chiusura_id = c.id;
      end loop;
      delete from cassa_spese where chiusura_id = c.id
        and id in (select (v #>> '{}')::uuid from jsonb_array_elements(coalesce(s->'elimina', '[]'::jsonb)) v);
      for x in select * from jsonb_array_elements(coalesce(s->'aggiungi', '[]'::jsonb)) loop
        insert into cassa_spese (chiusura_id, nome_spesa, categoria_id, importo, created_by)
        values (c.id, x->>'nome_spesa', nullif(x->>'categoria_id', '')::uuid, (x->>'importo')::numeric, m.richiesto_da);
      end loop;
    end if;
  end if;

  update cassa_chiusure_modifiche
    set stato = case when p_approva then 'approvata' else 'rifiutata' end,
        rivisto_da = auth.uid(), rivisto_at = now()
    where id = p_modifica_id;
end;
$$;

revoke all on function public.approva_modifica_chiusura(uuid, boolean) from public, anon;
grant execute on function public.approva_modifica_chiusura(uuid, boolean) to authenticated;
