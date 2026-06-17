alter table public.activities
add column if not exists processo_sei text,
add column if not exists internal_notes text;
