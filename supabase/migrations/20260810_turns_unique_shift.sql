-- Elimina i doppioni già presenti (stesso dipendente, stesso giorno,
-- stesso orario) tenendo la riga più vecchia, prima di poter imporre il
-- vincolo di unicità sotto — altrimenti la migration fallirebbe sui dati
-- già duplicati in produzione. (created_at, id) come chiave di confronto
-- invece del solo created_at, per un ordine deterministico anche nel caso
-- limite di due insert con lo stesso timestamp.
delete from turns t
using turns t2
where t.user_id = t2.user_id
  and t.date = t2.date
  and t.start_time = t2.start_time
  and t.end_time = t2.end_time
  and (t.created_at, t.id) > (t2.created_at, t2.id);

-- Due turni identici per lo stesso dipendente, stesso giorno, stesso
-- orario non sono mai un caso legittimo — sempre un doppione, che sia per
-- un doppio click sfuggito alla guardia lato client, un bug futuro non
-- ancora scoperto, o un retry di rete. Il vincolo protegge a livello di
-- database, indipendentemente da quale percorso applicativo tenti
-- l'inserimento — createTurn/createTurnsBulk lo trattano come "tienine
-- solo uno" (vedi commit collegato), updateTurn come errore di validazione
-- da mostrare a chi sta modificando.
alter table public.turns
  add constraint turns_no_duplicate_shift
  unique (user_id, date, start_time, end_time);
