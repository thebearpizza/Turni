-- confirmAiDraft in modalità "Rigenera tutto" cancellava i turni esistenti
-- della settimana e poi inseriva quelli della bozza in due chiamate
-- separate dal client: se l'insert falliva (es. doppione generato
-- dall'algoritmo) la delete restava comunque committata e la settimana
-- finiva vuota, senza rollback. Questa funzione esegue le due operazioni
-- nella stessa transazione: un errore nell'insert fa fallire l'intera
-- funzione e Postgres annulla anche la delete.
create or replace function public.confirm_ai_draft_replace(
  p_restaurant_id    uuid,
  p_week_start       date,
  p_week_end         date,
  p_department_scope text[],
  p_rows             jsonb
)
returns setof turns
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from turns
  where restaurant_id = p_restaurant_id
    and date >= p_week_start
    and date <= p_week_end
    and (p_department_scope is null or department::text = any(p_department_scope));

  return query
  insert into turns (
    user_id, restaurant_id, department, date, start_time, end_time,
    is_extraordinary, is_rest_day, notes, created_by
  )
  select
    user_id, restaurant_id, department, date, start_time, end_time,
    is_extraordinary, is_rest_day, notes, created_by
  from jsonb_populate_recordset(null::turns, p_rows)
  returning *;
end;
$$;

-- Chiamata solo dal client admin (service role) in confirmAiDraft, che ha
-- già verificato via RBAC applicativo che il chiamante può confermare
-- questa bozza: nessun altro ruolo deve poterla invocare direttamente.
revoke all on function public.confirm_ai_draft_replace(uuid, date, date, text[], jsonb) from public;
grant execute on function public.confirm_ai_draft_replace(uuid, date, date, text[], jsonb) to service_role;
