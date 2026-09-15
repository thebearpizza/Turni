-- Task 1 (Acquisti → Fornitori): la tabella fornitori esiste già (nata
-- come effetto collaterale dell'estrazione OCR) ma non aveva
-- un'interfaccia propria. Queste funzioni supportano la nuova pagina
-- /acquisti/fornitori: un riepilogo aggregato per l'elenco, il catalogo
-- con prezzo corrente per il dettaglio, e l'unione di due fornitori
-- duplicati.

-- SECURITY INVOKER (default): sono semplici letture aggregate, la RLS di
-- fornitori/fatture/catalogo_articoli fa già il suo lavoro scopando per
-- owner/ristorante secondo il ruolo di chi chiama — manager vede tutto
-- il proprio owner, direttore solo il proprio ristorante (stesso
-- perimetro già in vigore per /acquisti/fatture e /acquisti/articoli).
create or replace function public.fornitori_riepilogo(p_periodo_inizio date, p_periodo_fine date)
returns table (
  id uuid,
  nome text,
  partita_iva text,
  numero_fatture bigint,
  totale_periodo numeric,
  numero_articoli bigint
)
language sql
security invoker
stable
as $$
  select
    f.id,
    f.nome,
    f.partita_iva,
    (select count(*) from fatture ft where ft.fornitore_id = f.id) as numero_fatture,
    coalesce((
      select sum(ft.totale_lordo) from fatture ft
      where ft.fornitore_id = f.id and ft.data >= p_periodo_inizio and ft.data <= p_periodo_fine
    ), 0) as totale_periodo,
    (select count(*) from catalogo_articoli ca where ca.fornitore_id = f.id) as numero_articoli
  from fornitori f
  order by f.nome
$$;

-- Prezzo corrente = prezzo_unitario dell'ultima fattura per data (stessa
-- definizione di ultimo_prezzo_noto/fatturePrezzi.ts, qui in una sola
-- query batch per tutto il catalogo di un fornitore invece che articolo
-- per articolo).
create or replace function public.fornitore_catalogo_con_prezzo(p_fornitore_id uuid)
returns table (
  id uuid,
  nome_articolo text,
  tipologia text,
  unita_misura text,
  prezzo_corrente numeric
)
language sql
security invoker
stable
as $$
  select
    ca.id,
    ca.nome_articolo,
    ca.tipologia,
    ca.unita_misura,
    (
      select fa.prezzo_unitario
      from fatture_articoli fa
      join fatture ft on ft.id = fa.fattura_id
      where fa.catalogo_articolo_id = ca.id
      order by ft.data desc
      limit 1
    ) as prezzo_corrente
  from catalogo_articoli ca
  where ca.fornitore_id = p_fornitore_id
  order by ca.nome_articolo
$$;

-- Unione di due fornitori duplicati (stesso fornitore finito a sistema
-- due volte con nomi leggermente diversi): tutte le fatture e il
-- catalogo articoli del fornitore assorbito passano a quello mantenuto,
-- poi il record assorbito viene eliminato. Non reversibile — la
-- conferma esplicita è responsabilità della UI, non di questa funzione.
--
-- SECURITY DEFINER perché attraversa/modifica più tabelle collegate
-- (fatture, catalogo_articoli, fatture_articoli, articoli_mappature_testo)
-- in un'unica transazione atomica — stesso schema di cambia_fornitore_fattura,
-- di cui questa è la generalizzazione "su tutte le fatture di un
-- fornitore" invece che su una sola. Si autodifende internamente
-- (can_manage_restaurant): solo il manager può unire fornitori, come
-- da requisito "CRUD riservato al manager".
create or replace function public.unisci_fornitori(p_fornitore_da_assorbire uuid, p_fornitore_da_mantenere uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_assorbire uuid;
  v_owner_mantenere uuid;
  v_riga record;
  v_nuovo_catalogo_id uuid;
begin
  if p_fornitore_da_assorbire = p_fornitore_da_mantenere then
    raise exception 'Impossibile unire un fornitore con se stesso';
  end if;

  select owner_id into v_owner_assorbire from fornitori where id = p_fornitore_da_assorbire;
  select owner_id into v_owner_mantenere from fornitori where id = p_fornitore_da_mantenere;

  if v_owner_assorbire is null or v_owner_mantenere is null then
    raise exception 'Fornitore non trovato';
  end if;
  if v_owner_assorbire <> v_owner_mantenere then
    raise exception 'I due fornitori non appartengono allo stesso locale';
  end if;

  -- SECURITY DEFINER bypassa la RLS di fornitori: ripetuto qui lo stesso
  -- controllo che la UI farebbe comunque rispettare (solo manager).
  if not exists (
    select 1 from restaurants r where r.owner_id = v_owner_assorbire and can_manage_restaurant(r.id)
  ) then
    raise exception 'Non autorizzato';
  end if;

  -- Ogni articolo di catalogo del fornitore assorbito: se esiste già un
  -- omonimo per il fornitore mantenuto, le righe fattura che lo
  -- referenziano si spostano su quello esistente (dedup) e il vecchio
  -- viene eliminato; altrimenti l'articolo si sposta direttamente sul
  -- fornitore mantenuto (stessa logica di cambia_fornitore_fattura).
  for v_riga in
    select id as vecchio_catalogo_id, nome_articolo
    from catalogo_articoli
    where fornitore_id = p_fornitore_da_assorbire
  loop
    select id into v_nuovo_catalogo_id
    from catalogo_articoli
    where owner_id = v_owner_mantenere and fornitore_id = p_fornitore_da_mantenere and nome_articolo = v_riga.nome_articolo;

    if v_nuovo_catalogo_id is null then
      update catalogo_articoli set fornitore_id = p_fornitore_da_mantenere where id = v_riga.vecchio_catalogo_id;
    else
      update fatture_articoli set catalogo_articolo_id = v_nuovo_catalogo_id where catalogo_articolo_id = v_riga.vecchio_catalogo_id;

      -- Mappature testo→catalogo del vecchio articolo: si spostano sul
      -- nuovo catalogo/fornitore quando possibile (preserva il
      -- riconoscimento automatico OCR già imparato), si scartano solo se
      -- lo stesso testo è già mappato là (vince quella del mantenuto).
      delete from articoli_mappature_testo m1
      where m1.catalogo_articolo_id = v_riga.vecchio_catalogo_id
        and exists (
          select 1 from articoli_mappature_testo m2
          where m2.fornitore_id = p_fornitore_da_mantenere and m2.testo_estratto = m1.testo_estratto
        );
      update articoli_mappature_testo
      set catalogo_articolo_id = v_nuovo_catalogo_id, fornitore_id = p_fornitore_da_mantenere
      where catalogo_articolo_id = v_riga.vecchio_catalogo_id;

      delete from catalogo_articoli where id = v_riga.vecchio_catalogo_id;
    end if;
  end loop;

  -- Mappature testo→catalogo rimaste (quelle il cui catalogo non aveva un
  -- duplicato, quindi non toccate sopra): la chiave è
  -- (owner_id, fornitore_id, testo_estratto), vanno riassegnate al
  -- fornitore mantenuto. Un conflitto (stesso testo già mappato lì) si
  -- risolve tenendo quella del fornitore mantenuto.
  delete from articoli_mappature_testo m1
  where m1.fornitore_id = p_fornitore_da_assorbire
    and exists (
      select 1 from articoli_mappature_testo m2
      where m2.fornitore_id = p_fornitore_da_mantenere and m2.testo_estratto = m1.testo_estratto
    );
  update articoli_mappature_testo set fornitore_id = p_fornitore_da_mantenere where fornitore_id = p_fornitore_da_assorbire;

  update fatture set fornitore_id = p_fornitore_da_mantenere, updated_by = auth.uid() where fornitore_id = p_fornitore_da_assorbire;

  -- Partita IVA: se il fornitore mantenuto non l'aveva ma quello
  -- assorbito sì, la si recupera invece di perderla nella fusione.
  update fornitori dst
  set partita_iva = src.partita_iva
  from fornitori src
  where dst.id = p_fornitore_da_mantenere and src.id = p_fornitore_da_assorbire
    and dst.partita_iva is null and src.partita_iva is not null;

  delete from fornitori where id = p_fornitore_da_assorbire;
end;
$function$;
