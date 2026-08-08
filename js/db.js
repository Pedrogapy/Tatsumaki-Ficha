(function () {
  const config = window.APP_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const systemSlug = params.get('system') || 'thaloria';
  const accessKey = params.get('key') || '';
  const initialCharacterSlug = params.get('character') || 'tatsumaki-shadowheart-gojo';

  const remoteConfigured = Boolean(
    config.supabaseUrl && /^https:\/\//.test(config.supabaseUrl) &&
    config.supabaseKey && config.supabaseKey.length > 20 &&
    window.supabase?.createClient
  );
  const remoteEnabled = remoteConfigured && Boolean(accessKey);
  const client = remoteConfigured ? window.supabase.createClient(config.supabaseUrl, config.supabaseKey) : null;

  const storageKey = `rpg-sheet:${systemSlug}`;

  async function loadSeed() {
    const response = await fetch('./data/tatsumaki-seed.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível carregar a ficha inicial.');
    return response.json();
  }

  async function ensureLocalStore() {
    const current = localStorage.getItem(storageKey);
    if (current) return JSON.parse(current);
    const seed = await loadSeed();
    const local = {
      system: seed.system,
      characters: [{
        slug: seed.character.slug,
        name: seed.character.name,
        data: seed.character.data,
        combat: seed.character.combat,
        updated_at: new Date().toISOString()
      }]
    };
    localStorage.setItem(storageKey, JSON.stringify(local));
    return local;
  }

  function saveLocalStore(store) {
    localStorage.setItem(storageKey, JSON.stringify(store));
  }

  function publicCharacterMeta(character) {
    return {
      slug: character.slug,
      name: character.name,
      updated_at: character.updated_at || new Date().toISOString()
    };
  }

  async function getLocalSnapshot(characterSlug = initialCharacterSlug) {
    const store = await ensureLocalStore();
    let character = store.characters.find((item) => item.slug === characterSlug);
    if (!character) character = store.characters[0] || null;
    return {
      system: store.system,
      characters: store.characters.map(publicCharacterMeta),
      character: character ? RPG.clone(character) : null,
      mode: 'local'
    };
  }

  async function getRemoteSnapshot(characterSlug = initialCharacterSlug) {
    const { data, error } = await client.rpc('get_system_snapshot', {
      p_system_slug: systemSlug,
      p_access_key: accessKey,
      p_character_slug: characterSlug || null
    });
    if (error) throw error;
    return { ...data, mode: 'remote' };
  }

  async function getSnapshot(characterSlug = initialCharacterSlug) {
    return remoteEnabled ? getRemoteSnapshot(characterSlug) : getLocalSnapshot(characterSlug);
  }

  async function saveCharacter(characterSlug, name, data, combat) {
    if (remoteEnabled) {
      const { data: result, error } = await client.rpc('save_character', {
        p_system_slug: systemSlug,
        p_access_key: accessKey,
        p_character_slug: characterSlug,
        p_name: name,
        p_data: data,
        p_combat: combat
      });
      if (error) throw error;
      return result;
    }

    const store = await ensureLocalStore();
    const index = store.characters.findIndex((item) => item.slug === characterSlug);
    if (index < 0) throw new Error('Personagem local não encontrado.');
    store.characters[index] = {
      ...store.characters[index], name, data: RPG.clone(data), combat: RPG.clone(combat), updated_at: new Date().toISOString()
    };
    saveLocalStore(store);
    return publicCharacterMeta(store.characters[index]);
  }

  async function saveRules(rules) {
    if (remoteEnabled) {
      const { data, error } = await client.rpc('save_system_rules', {
        p_system_slug: systemSlug,
        p_access_key: accessKey,
        p_rules: rules
      });
      if (error) throw error;
      return data;
    }
    const store = await ensureLocalStore();
    store.system.rules = RPG.clone(rules);
    saveLocalStore(store);
    return store.system;
  }

  async function createCharacter(slug, name, data, combat) {
    if (remoteEnabled) {
      const { data: result, error } = await client.rpc('create_character', {
        p_system_slug: systemSlug,
        p_access_key: accessKey,
        p_character_slug: slug,
        p_name: name,
        p_data: data,
        p_combat: combat
      });
      if (error) throw error;
      return result;
    }

    const store = await ensureLocalStore();
    if (store.characters.some((item) => item.slug === slug)) throw new Error('Já existe uma ficha com esse identificador.');
    const character = { slug, name, data: RPG.clone(data), combat: RPG.clone(combat), updated_at: new Date().toISOString() };
    store.characters.push(character);
    saveLocalStore(store);
    return publicCharacterMeta(character);
  }

  async function deleteCharacter(slug) {
    if (remoteEnabled) {
      const { data, error } = await client.rpc('delete_character', {
        p_system_slug: systemSlug,
        p_access_key: accessKey,
        p_character_slug: slug
      });
      if (error) throw error;
      return data;
    }
    const store = await ensureLocalStore();
    if (store.characters.length <= 1) throw new Error('Não é possível apagar a última ficha.');
    store.characters = store.characters.filter((item) => item.slug !== slug);
    saveLocalStore(store);
    return true;
  }

  function updateUrlCharacter(slug) {
    const url = new URL(location.href);
    url.searchParams.set('system', systemSlug);
    url.searchParams.set('character', slug);
    if (accessKey) url.searchParams.set('key', accessKey);
    history.replaceState({}, '', url);
  }

  window.DB = {
    systemSlug, accessKey, initialCharacterSlug,
    remoteConfigured, remoteEnabled,
    getSnapshot, saveCharacter, saveRules, createCharacter, deleteCharacter,
    updateUrlCharacter
  };
})();
