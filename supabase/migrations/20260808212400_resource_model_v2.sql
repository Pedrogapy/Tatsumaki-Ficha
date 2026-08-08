-- Modelo de recursos v2: P.S/P.F dinamicos, dano verdadeiro, P.V dividido e backups JSON.

create table if not exists public.rpg_character_backups (
  id bigserial primary key,
  character_id uuid not null references public.rpg_characters(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists rpg_character_backups_character_created_idx
  on public.rpg_character_backups(character_id, created_at desc);

alter table public.rpg_character_backups enable row level security;
revoke all on public.rpg_character_backups from anon, authenticated;

-- Antes de converter qualquer coisa, guarda uma copia JSON do estado atual.
insert into public.rpg_character_backups(character_id, snapshot)
select c.id, jsonb_build_object(
  'schemaVersion', coalesce((c.data->>'schemaVersion')::int, 1),
  'savedAt', now(),
  'reason', 'pre-resource-model-v2',
  'slug', c.slug,
  'name', c.name,
  'data', c.data,
  'combat', c.combat
)
from public.rpg_characters c
where not exists (
  select 1 from public.rpg_character_backups b where b.character_id = c.id
);

-- Converte os recursos e custos que ja existem no banco.
update public.rpg_characters
set data = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        data,
        '{resources,ps,trueDamage}',
        to_jsonb(coalesce(nullif(data #>> '{resources,ps,trueDamage}', '')::numeric, 0)),
        true
      ),
      '{resources,pv,attackLost}',
      to_jsonb(coalesce(nullif(data #>> '{resources,pv,attackLost}', '')::numeric, nullif(data #>> '{resources,pv,lost}', '')::numeric, 0)),
      true
    ),
    '{resources,pv,reactionLost}',
    to_jsonb(coalesce(nullif(data #>> '{resources,pv,reactionLost}', '')::numeric, 0)),
    true
  ),
  '{resources,pv,lost}', '0'::jsonb, true
);

update public.rpg_characters c
set data = jsonb_set(
  c.data,
  '{abilities}',
  coalesce((
    select jsonb_agg(
      case
        when ability ? 'cost' and jsonb_typeof(ability->'cost') = 'object' then
          jsonb_set(
            ability,
            '{cost}',
            (
              ((ability->'cost') - ARRAY['pv','pvDefense']::text[])
              || jsonb_build_object(
                'pvAttack',
                coalesce(nullif((ability->'cost')->>'pvAttack', '')::numeric, 0)
                + coalesce(nullif((ability->'cost')->>'pv', '')::numeric, 0)
              )
              || jsonb_build_object(
                'pvReaction',
                coalesce(nullif((ability->'cost')->>'pvReaction', '')::numeric, 0)
                + coalesce(nullif((ability->'cost')->>'pvDefense', '')::numeric, 0)
              )
            ),
            true
          )
        else ability
      end
      order by ordinality
    )
    from jsonb_array_elements(coalesce(c.data->'abilities', '[]'::jsonb)) with ordinality as t(ability, ordinality)
  ), '[]'::jsonb),
  true
)
where jsonb_typeof(c.data->'abilities') = 'array';

update public.rpg_characters
set data = jsonb_set(data, '{schemaVersion}', '2'::jsonb, true);

-- Cada save remoto passa a criar uma copia JSON no historico.
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
    raise exception 'Chave de acesso invalida para este sistema';
  end if;

  update public.rpg_characters
  set name = coalesce(nullif(trim(p_name), ''), name),
      data = coalesce(p_data, data),
      combat = coalesce(p_combat, combat)
  where system_id = v_system_id and slug = p_character_slug
  returning * into v_character;

  if v_character.id is null then
    raise exception 'Personagem nao encontrado';
  end if;

  insert into public.rpg_character_backups(character_id, snapshot)
  values (
    v_character.id,
    jsonb_build_object(
      'schemaVersion', 2,
      'savedAt', now(),
      'slug', v_character.slug,
      'name', v_character.name,
      'data', v_character.data,
      'combat', v_character.combat
    )
  );

  -- Mantem os 100 snapshots mais recentes por personagem.
  delete from public.rpg_character_backups
  where character_id = v_character.id
    and id not in (
      select id
      from public.rpg_character_backups
      where character_id = v_character.id
      order by created_at desc, id desc
      limit 100
    );

  return jsonb_build_object(
    'slug', v_character.slug,
    'name', v_character.name,
    'updated_at', v_character.updated_at
  );
end;
$$;

revoke all on function public.save_character(text, uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.save_character(text, uuid, text, text, jsonb, jsonb) to anon, authenticated;

-- Novas fichas tambem recebem um snapshot JSON inicial.
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
    raise exception 'Chave de acesso invalida para este sistema';
  end if;

  if p_character_slug !~ '^[a-z0-9][a-z0-9-]{0,79}$' then
    raise exception 'Identificador de personagem invalido';
  end if;

  insert into public.rpg_characters(system_id, slug, name, data, combat)
  values (
    v_system_id,
    p_character_slug,
    nullif(trim(p_name), ''),
    coalesce(p_data, '{}'::jsonb),
    coalesce(p_combat, '{}'::jsonb)
  )
  returning * into v_character;

  insert into public.rpg_character_backups(character_id, snapshot)
  values (
    v_character.id,
    jsonb_build_object(
      'schemaVersion', 2,
      'savedAt', now(),
      'slug', v_character.slug,
      'name', v_character.name,
      'data', v_character.data,
      'combat', v_character.combat
    )
  );

  return jsonb_build_object(
    'slug', v_character.slug,
    'name', v_character.name,
    'updated_at', v_character.updated_at
  );
exception
  when unique_violation then
    raise exception 'Ja existe uma ficha com esse identificador';
end;
$$;

revoke all on function public.create_character(text, uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.create_character(text, uuid, text, text, jsonb, jsonb) to anon, authenticated;


