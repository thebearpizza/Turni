-- ─────────────────────────────────────────────────────────────────────────────
-- SaaS Multi-tenancy Migration
-- Esegui questo script nel SQL Editor di Supabase
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonne nuove su profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active'
    CHECK (account_status IN ('pending', 'active')),
  ADD COLUMN IF NOT EXISTS managed_restaurant_ids uuid[] DEFAULT NULL;
-- NULL = platform owner (vede tutto); '{}' = nessun ristorante; '{uuid,...}' = ristoranti assegnati

-- 2. Colonne nuove su restaurants
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS is_demo    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_id   uuid    REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. I manager esistenti diventano platform owner (accesso totale mantenuto)
UPDATE profiles
SET managed_restaurant_ids = NULL
WHERE role = 'manager';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helper function per RLS — restituisce true se il manager corrente
--    può accedere al ristorante indicato
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION can_manage_restaurant(rid uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'manager'
      AND (
        managed_restaurant_ids IS NULL                  -- platform owner: accesso totale
        OR rid = ANY(managed_restaurant_ids)            -- accesso esplicito
      )
  )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS: restaurants
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "managers_can_manage_restaurants"        ON restaurants;
DROP POLICY IF EXISTS "manager_select_restaurants"             ON restaurants;
DROP POLICY IF EXISTS "manager_insert_restaurants"             ON restaurants;
DROP POLICY IF EXISTS "manager_update_restaurants"             ON restaurants;
DROP POLICY IF EXISTS "manager_delete_restaurants"             ON restaurants;

CREATE POLICY "manager_select_restaurants" ON restaurants
  FOR SELECT USING (can_manage_restaurant(id));

CREATE POLICY "manager_insert_restaurants" ON restaurants
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'manager')
  );

CREATE POLICY "manager_update_restaurants" ON restaurants
  FOR UPDATE USING (can_manage_restaurant(id));

CREATE POLICY "manager_delete_restaurants" ON restaurants
  FOR DELETE USING (can_manage_restaurant(id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS: profiles — i manager vedono solo dipendenti dei propri ristoranti
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "manager_select_profiles"  ON profiles;
DROP POLICY IF EXISTS "manager_update_profiles"  ON profiles;
DROP POLICY IF EXISTS "manager_delete_profiles"  ON profiles;

CREATE POLICY "manager_select_profiles" ON profiles
  FOR SELECT USING (
    id = auth.uid()                                      -- ognuno vede se stesso
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'manager'
        AND (
          p.managed_restaurant_ids IS NULL
          OR profiles.restaurant_id = ANY(p.managed_restaurant_ids)
          OR profiles.role = 'manager'                  -- i manager vedono gli altri manager
        )
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('capo_servizio', 'consulente_lavoro')
    )
  );

CREATE POLICY "manager_update_profiles" ON profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'manager'
        AND (
          p.managed_restaurant_ids IS NULL
          OR profiles.restaurant_id = ANY(p.managed_restaurant_ids)
        )
    )
  );

CREATE POLICY "manager_delete_profiles" ON profiles
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'manager'
        AND (
          p.managed_restaurant_ids IS NULL
          OR profiles.restaurant_id = ANY(p.managed_restaurant_ids)
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS: turns, shift_slots, absences, attendances, standard_shifts
--    Pattern comune: manager accede se può gestire il restaurant_id della riga
-- ─────────────────────────────────────────────────────────────────────────────

-- turns
DROP POLICY IF EXISTS "manager_select_turns"  ON turns;
DROP POLICY IF EXISTS "manager_insert_turns"  ON turns;
DROP POLICY IF EXISTS "manager_update_turns"  ON turns;
DROP POLICY IF EXISTS "manager_delete_turns"  ON turns;

CREATE POLICY "manager_select_turns" ON turns
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
      AND (p.role IN ('capo_servizio','dipendente') OR can_manage_restaurant(turns.restaurant_id)))
    OR user_id = auth.uid()
  );
CREATE POLICY "manager_insert_turns" ON turns
  FOR INSERT WITH CHECK (can_manage_restaurant(restaurant_id));
CREATE POLICY "manager_update_turns" ON turns
  FOR UPDATE USING (can_manage_restaurant(restaurant_id));
CREATE POLICY "manager_delete_turns" ON turns
  FOR DELETE USING (can_manage_restaurant(restaurant_id));

-- shift_slots
DROP POLICY IF EXISTS "manager_select_shift_slots"  ON shift_slots;
DROP POLICY IF EXISTS "manager_insert_shift_slots"  ON shift_slots;
DROP POLICY IF EXISTS "manager_update_shift_slots"  ON shift_slots;
DROP POLICY IF EXISTS "manager_delete_shift_slots"  ON shift_slots;

CREATE POLICY "manager_select_shift_slots" ON shift_slots
  FOR SELECT USING (
    can_manage_restaurant(restaurant_id)
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
      AND p.restaurant_id = shift_slots.restaurant_id)
  );
CREATE POLICY "manager_insert_shift_slots" ON shift_slots
  FOR INSERT WITH CHECK (can_manage_restaurant(restaurant_id));
CREATE POLICY "manager_update_shift_slots" ON shift_slots
  FOR UPDATE USING (can_manage_restaurant(restaurant_id));
CREATE POLICY "manager_delete_shift_slots" ON shift_slots
  FOR DELETE USING (can_manage_restaurant(restaurant_id));

-- ai_schedule_drafts
DROP POLICY IF EXISTS "manager_select_ai_drafts"  ON ai_schedule_drafts;
DROP POLICY IF EXISTS "manager_insert_ai_drafts"  ON ai_schedule_drafts;
DROP POLICY IF EXISTS "manager_update_ai_drafts"  ON ai_schedule_drafts;

CREATE POLICY "manager_select_ai_drafts" ON ai_schedule_drafts
  FOR SELECT USING (can_manage_restaurant(restaurant_id));
CREATE POLICY "manager_insert_ai_drafts" ON ai_schedule_drafts
  FOR INSERT WITH CHECK (can_manage_restaurant(restaurant_id));
CREATE POLICY "manager_update_ai_drafts" ON ai_schedule_drafts
  FOR UPDATE USING (can_manage_restaurant(restaurant_id));

-- ai_schedule_draft_turns (read via draft's restaurant)
DROP POLICY IF EXISTS "manager_select_ai_draft_turns"  ON ai_schedule_draft_turns;
DROP POLICY IF EXISTS "manager_insert_ai_draft_turns"  ON ai_schedule_draft_turns;
DROP POLICY IF EXISTS "manager_update_ai_draft_turns"  ON ai_schedule_draft_turns;

CREATE POLICY "manager_select_ai_draft_turns" ON ai_schedule_draft_turns
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM ai_schedule_drafts d
      WHERE d.id = ai_schedule_draft_turns.draft_id
        AND can_manage_restaurant(d.restaurant_id))
    OR user_id = auth.uid()
  );
CREATE POLICY "manager_insert_ai_draft_turns" ON ai_schedule_draft_turns
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM ai_schedule_drafts d
      WHERE d.id = draft_id AND can_manage_restaurant(d.restaurant_id))
  );
CREATE POLICY "manager_update_ai_draft_turns" ON ai_schedule_draft_turns
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM ai_schedule_drafts d
      WHERE d.id = ai_schedule_draft_turns.draft_id
        AND can_manage_restaurant(d.restaurant_id))
  );
