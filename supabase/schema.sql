-- Banco de dados da ficha RPG.
-- O frontend nunca recebe acesso direto às tabelas: usa apenas RPCs que validam a chave do sistema.

create extension if not exists pgcrypto;

create table if not exists public.rpg_systems (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  access_key uuid not null default gen_random_uuid(),
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rpg_characters (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.rpg_systems(id) on delete cascade,
  slug text not null,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  combat jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(system_id, slug)
);

create index if not exists rpg_characters_system_id_idx on public.rpg_characters(system_id);

alter table public.rpg_systems enable row level security;
alter table public.rpg_characters enable row level security;

-- Nenhuma policy de tabela é criada de propósito. As operações públicas passam pelas funções abaixo.
revoke all on public.rpg_systems from anon, authenticated;
revoke all on public.rpg_characters from anon, authenticated;

create or replace function public.touch_rpg_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rpg_systems_updated_at on public.rpg_systems;
create trigger trg_rpg_systems_updated_at
before update on public.rpg_systems
for each row execute function public.touch_rpg_updated_at();

drop trigger if exists trg_rpg_characters_updated_at on public.rpg_characters;
create trigger trg_rpg_characters_updated_at
before update on public.rpg_characters
for each row execute function public.touch_rpg_updated_at();

create or replace function public.get_system_snapshot(
  p_system_slug text,
  p_access_key uuid,
  p_character_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system public.rpg_systems%rowtype;
  v_character public.rpg_characters%rowtype;
  v_list jsonb;
begin
  select * into v_system
  from public.rpg_systems
  where slug = p_system_slug and access_key = p_access_key;

  if not found then
    raise exception 'Chave de acesso inválida para este sistema';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', c.slug,
    'name', c.name,
    'updated_at', c.updated_at
  ) order by c.name), '[]'::jsonb)
  into v_list
  from public.rpg_characters c
  where c.system_id = v_system.id;

  if p_character_slug is not null then
    select * into v_character
    from public.rpg_characters
    where system_id = v_system.id and slug = p_character_slug;
  end if;

  if v_character.id is null then
    select * into v_character
    from public.rpg_characters
    where system_id = v_system.id
    order by created_at
    limit 1;
  end if;

  return jsonb_build_object(
    'system', jsonb_build_object(
      'slug', v_system.slug,
      'name', v_system.name,
      'rules', v_system.rules,
      'updated_at', v_system.updated_at
    ),
    'characters', v_list,
    'character', case when v_character.id is null then null else jsonb_build_object(
      'slug', v_character.slug,
      'name', v_character.name,
      'data', v_character.data,
      'combat', v_character.combat,
      'updated_at', v_character.updated_at
    ) end
  );
end;
$$;

create or replace function public.save_character(
  p_system_slug text,
  p_access_key uuid,
  p_character_slug text,
  p_name text,
  p_data jsonb,
  p_combat jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system_id uuid;
  v_character public.rpg_characters%rowtype;
begin
  select id into v_system_id
  from public.rpg_systems
  where slug = p_system_slug and access_key = p_access_key;

  if v_system_id is null then
    raise exception 'Chave de acesso inválida para este sistema';
  end if;

  update public.rpg_characters
  set name = coalesce(nullif(trim(p_name), ''), name),
      data = coalesce(p_data, data),
      combat = coalesce(p_combat, combat)
  where system_id = v_system_id and slug = p_character_slug
  returning * into v_character;

  if v_character.id is null then
    raise exception 'Personagem não encontrado';
  end if;

  return jsonb_build_object('slug', v_character.slug, 'name', v_character.name, 'updated_at', v_character.updated_at);
end;
$$;

create or replace function public.save_system_rules(
  p_system_slug text,
  p_access_key uuid,
  p_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system public.rpg_systems%rowtype;
begin
  update public.rpg_systems
  set rules = coalesce(p_rules, '{}'::jsonb)
  where slug = p_system_slug and access_key = p_access_key
  returning * into v_system;

  if v_system.id is null then
    raise exception 'Chave de acesso inválida para este sistema';
  end if;

  return jsonb_build_object('slug', v_system.slug, 'name', v_system.name, 'rules', v_system.rules, 'updated_at', v_system.updated_at);
end;
$$;

create or replace function public.create_character(
  p_system_slug text,
  p_access_key uuid,
  p_character_slug text,
  p_name text,
  p_data jsonb,
  p_combat jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system_id uuid;
  v_character public.rpg_characters%rowtype;
begin
  select id into v_system_id
  from public.rpg_systems
  where slug = p_system_slug and access_key = p_access_key;

  if v_system_id is null then
    raise exception 'Chave de acesso inválida para este sistema';
  end if;

  if p_character_slug !~ '^[a-z0-9][a-z0-9-]{0,79}$' then
    raise exception 'Identificador de personagem inválido';
  end if;

  insert into public.rpg_characters(system_id, slug, name, data, combat)
  values (v_system_id, p_character_slug, nullif(trim(p_name), ''), coalesce(p_data, '{}'::jsonb), coalesce(p_combat, '{}'::jsonb))
  returning * into v_character;

  return jsonb_build_object('slug', v_character.slug, 'name', v_character.name, 'updated_at', v_character.updated_at);
exception
  when unique_violation then
    raise exception 'Já existe uma ficha com esse identificador';
end;
$$;

create or replace function public.delete_character(
  p_system_slug text,
  p_access_key uuid,
  p_character_slug text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system_id uuid;
  v_count integer;
begin
  select id into v_system_id
  from public.rpg_systems
  where slug = p_system_slug and access_key = p_access_key;

  if v_system_id is null then
    raise exception 'Chave de acesso inválida para este sistema';
  end if;

  select count(*) into v_count from public.rpg_characters where system_id = v_system_id;
  if v_count <= 1 then
    raise exception 'Não é possível apagar a última ficha';
  end if;

  delete from public.rpg_characters where system_id = v_system_id and slug = p_character_slug;
  return found;
end;
$$;

revoke all on function public.get_system_snapshot(text, uuid, text) from public;
revoke all on function public.save_character(text, uuid, text, text, jsonb, jsonb) from public;
revoke all on function public.save_system_rules(text, uuid, jsonb) from public;
revoke all on function public.create_character(text, uuid, text, text, jsonb, jsonb) from public;
revoke all on function public.delete_character(text, uuid, text) from public;

grant execute on function public.get_system_snapshot(text, uuid, text) to anon, authenticated;
grant execute on function public.save_character(text, uuid, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.save_system_rules(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.create_character(text, uuid, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.delete_character(text, uuid, text) to anon, authenticated;
