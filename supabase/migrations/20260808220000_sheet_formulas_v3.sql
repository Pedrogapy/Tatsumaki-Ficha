-- Formulas v3: alinhar o site com as formulas originais da planilha do sistema.
-- Mantem os dados atuais, cria um snapshot antes da conversao e passa a usar
-- maxBonus em vez de um "max" digitado manualmente.

-- Backup unico antes da mudanca de formulas.
insert into public.rpg_character_backups(character_id, snapshot)
select c.id, jsonb_build_object(
  'schemaVersion', coalesce((c.data->>'schemaVersion')::int, 2),
  'savedAt', now(),
  'reason', 'pre-sheet-formulas-v3',
  'slug', c.slug,
  'name', c.name,
  'data', c.data,
  'combat', c.combat
)
from public.rpg_characters c
where not exists (
  select 1
  from public.rpg_character_backups b
  where b.character_id = c.id
    and b.snapshot->>'reason' = 'pre-sheet-formulas-v3'
);

-- Regras globais: a coluna Pontos da pericia nao entra no Total da planilha.
update public.rpg_systems
set rules =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(rules, '{}'::jsonb),
        '{schemaVersion}',
        '3'::jsonb,
        true
      ),
      '{skill,includePoints}',
      'false'::jsonb,
      true
    ),
    '{formulaProfile}',
    '"tatsumaki-sheet-v1"'::jsonb,
    true
  )
where slug = 'thaloria';

-- Recursos agora possuem apenas um bonus opcional sobre o maximo calculado.
-- O campo max antigo e preservado para compatibilidade/historico, mas o frontend v3
-- calcula os maximos diretamente pelas formulas da ficha.
update public.rpg_characters
set data =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(data, '{}'::jsonb),
          '{resources,ps,maxBonus}',
          coalesce(data #> '{resources,ps,maxBonus}', '0'::jsonb),
          true
        ),
        '{resources,pf,maxBonus}',
        coalesce(data #> '{resources,pf,maxBonus}', '0'::jsonb),
        true
      ),
      '{resources,pv,maxBonus}',
      coalesce(data #> '{resources,pv,maxBonus}', '0'::jsonb),
      true
    ),
    '{schemaVersion}',
    '3'::jsonb,
    true
  );

-- Atualiza a versao dos snapshots futuros sem mudar a seguranca/RPC existente.
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
      'schemaVersion', coalesce((v_character.data->>'schemaVersion')::int, 3),
      'savedAt', now(),
      'slug', v_character.slug,
      'name', v_character.name,
      'data', v_character.data,
      'combat', v_character.combat
    )
  );

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
