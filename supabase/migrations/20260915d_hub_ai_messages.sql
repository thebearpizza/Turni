-- Task 4: cronologia dell'assistente IA per l'ingresso trasversale nella
-- Home web (barra in fondo) — stessa forma di telegram_ai_messages, ma
-- chiave sul profilo (uuid) invece che sul telegram_id (bigint), dato che
-- questa conversazione nasce da una sessione autenticata dell'app web,
-- non da un account Telegram collegato. Tabella distinta invece di
-- riusare/alterare telegram_ai_messages (dati di produzione già in uso
-- dal bot): stesso schema, stesso pattern RLS (nessuna policy diretta,
-- solo il client service-role di runAiAssistant la tocca — vedi
-- src/lib/hub/aiHistory.ts).
create table public.hub_ai_messages (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.hub_ai_messages enable row level security;
