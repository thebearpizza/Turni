-- Pulizia delle voci di spesa dei locali (proprietario 125c49d2...):
-- le spese di lavaggio già salvate passano a "Lavapiatti" (il trigger
-- cassa_spese_accorpa_lavapiatti le riscrive al semplice update), e la
-- categoria Pulizie si toglie: l'extra sala va in Personale, i guanti in
-- Fornitori/Merce. Pulizie dell'account di prova resta.
update public.cassa_spese set nome_spesa = nome_spesa
where nome_spesa ~* '\m(lavaggio|lavaggi|lavapiatti|lava piatti)\M';
update public.cassa_spese_bozza set nome_spesa = nome_spesa
where nome_spesa ~* '\m(lavaggio|lavaggi|lavapiatti|lava piatti)\M';

update public.cassa_spese set categoria_id = 'b2000000-0000-4000-8000-000000000001'
where categoria_id = 'b2000000-0000-4000-8000-000000000005' and nome_spesa = 'Sonny extra sala';
update public.cassa_spese set categoria_id = 'b2000000-0000-4000-8000-000000000003'
where categoria_id = 'b2000000-0000-4000-8000-000000000005' and nome_spesa = 'Guanti';

delete from public.cassa_categorie c
where c.id = 'b2000000-0000-4000-8000-000000000005'
  and not exists (select 1 from public.cassa_spese s where s.categoria_id = c.id)
  and not exists (select 1 from public.cassa_spese_bozza b where b.categoria_id = c.id);
