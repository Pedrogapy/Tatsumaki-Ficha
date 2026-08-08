# Ficha Web RPG • Tatsumaki / Thaloria

Uma versão web funcional da planilha **Tatsumaki ShadowHeart Gojo**, preparada para GitHub Pages e Supabase.

A primeira ficha importada é a do Tatsumaki, mas o projeto já permite criar outras fichas usando as mesmas regras globais do sistema.

## O que já funciona

- Ficha moderna e responsiva, inspirada na organização da planilha original.
- Dados do personagem editáveis com salvamento automático.
- Atributos com **modificadores individuais**, que podem ser ligados, desligados, renomeados e alterados.
- Cálculo automático de 1/4, 1/8 e totais de perícia.
- Perícias completas importadas da ficha atual.
- P.S, P.V e P.F com `perdidos`, `máximo`, `temporário` e valor atual calculado.
- Classe de Armadura com decomposição dos bônus.
- Inventário editável.
- Karma positivo e negativo.
- Trilhas de Essência e estágios.
- Arquivo com textos longos importados da planilha.
- Modo de combate com:
  - gasto e recuperação rápida de P.S/P.V/P.F;
  - rodadas e turnos;
  - cooldown automático;
  - contador de usos;
  - Pontos de Caos;
  - posturas;
  - transformações;
  - condições, buffs e debuffs;
  - rolagem de dados;
  - histórico de rolagens.
- Criação de novas fichas no mesmo sistema.
- Área discreta de **Configurações avançadas** para alterar regras globais.
- Modo local automático quando o Supabase ainda não foi configurado.

## Estrutura

```text
.
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── config.js
│   ├── config.example.js
│   ├── db.js
│   └── rules.js
├── data/
│   └── tatsumaki-seed.json
├── supabase/
│   ├── schema.sql
│   └── seed.sql
└── .github/workflows/
    └── pages.yml
```

## 1. Testar sem banco de dados

Na pasta do projeto, abra um terminal e execute:

```bash
python -m http.server 8000
```

Depois abra:

```text
http://localhost:8000
```

O site entrará em **modo local**. Nesse modo ele usa `localStorage`, então você pode testar toda a interface antes de configurar o banco.

> Não abra o `index.html` diretamente pelo explorador de arquivos, porque o navegador pode bloquear o carregamento do JSON inicial por `file://`.

## 2. Criar o banco no Supabase

Crie um projeto em:

```text
https://supabase.com/dashboard
```

Depois abra o SQL Editor.

Execute primeiro todo o conteúdo de:

```text
supabase/schema.sql
```

Depois execute:

```text
supabase/seed.sql
```

No final do `seed.sql`, o Supabase retornará algo semelhante a:

```text
system_slug | access_key                           | character_slug
thaloria    | 12ab34cd-....-....-....-............ | tatsumaki-shadowheart-gojo
```

Guarde o valor de `access_key`.

**Essa chave é o segredo do link compartilhado. Não coloque essa chave no GitHub.**

## 3. Conectar o site ao Supabase

No painel do Supabase, copie:

- Project URL
- Publishable key ou anon key do projeto

Abra:

```text
js/config.js
```

E preencha:

```javascript
window.APP_CONFIG = {
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabaseKey: "SUA_PUBLISHABLE_OU_ANON_KEY"
};
```

A chave pública do Supabase fica no frontend. A proteção real dos dados está no banco: as tabelas não são liberadas diretamente para `anon`/`authenticated`; o site chama funções RPC que validam a `access_key` do sistema.

Documentação oficial do Supabase:

```text
https://supabase.com/docs/reference/javascript/initializing
https://supabase.com/docs/guides/database/postgres/row-level-security
https://supabase.com/docs/guides/api/securing-your-api
```

## 4. Abrir a ficha conectada ao banco

Use:

```text
http://localhost:8000/?system=thaloria&key=SUA_ACCESS_KEY&character=tatsumaki-shadowheart-gojo
```

Quando estiver conectado corretamente, o topo mostrará **Conectado ao banco** / **Salvo no banco**.

O mesmo formato será usado no GitHub Pages.

## 5. Subir no GitHub

Crie um repositório vazio no GitHub. Depois, dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "Ficha web do Tatsumaki"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

O projeto já contém um workflow em `.github/workflows/pages.yml`.

No GitHub:

1. Abra **Settings** do repositório.
2. Entre em **Pages**.
3. Em **Build and deployment**, escolha **GitHub Actions**.
4. Faça um novo push ou execute manualmente o workflow `Deploy GitHub Pages`.

Documentação oficial:

```text
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
```

## 6. Link final

Se o endereço publicado for, por exemplo:

```text
https://pedro.github.io/tatsumaki-ficha/
```

O link real da ficha será:

```text
https://pedro.github.io/tatsumaki-ficha/?system=thaloria&key=SUA_ACCESS_KEY&character=tatsumaki-shadowheart-gojo
```

Quem possuir **esse link completo** consegue acessar e alterar as fichas do sistema.

Não compartilhe somente a `access_key` isoladamente. Na prática, trate o link inteiro como uma senha de acesso.

## Como o acesso funciona

O GitHub Pages só hospeda HTML/CSS/JavaScript. O banco fica no Supabase.

As tabelas `rpg_systems` e `rpg_characters` ficam sem acesso direto para visitantes. O navegador chama apenas estas funções:

```text
get_system_snapshot
save_character
save_system_rules
create_character
delete_character
```

Cada função exige:

```text
system_slug + access_key
```

Isso permite o modelo que você pediu: **sem tela de login, quem tem o link entra**.

## Criar outras fichas

No topo do site existe o botão `+`.

Você pode:

- criar uma ficha limpa usando o mesmo conjunto de perícias e regras;
- duplicar a ficha atual;
- alternar entre personagens pelo seletor do topo.

As regras globais continuam compartilhadas.

## Configurações avançadas

O ícone de engrenagem no canto superior direito abre a área de regras. Ela fica fora do fluxo normal para não ocupar espaço durante as sessões.

Na versão atual podem ser alterados:

- divisor usado para 1/4;
- divisor usado para 1/8;
- margem crítica padrão;
- inclusão de nível no cálculo da perícia;
- inclusão de pontos extras;
- bônus de proficiência.

A estrutura do banco já permite expandir isso depois para regras muito mais específicas.

## Sobre a importação da planilha

Foram trazidos para a versão inicial:

- atributos e seus valores atuais;
- decomposição matemática dos atributos presente nas fórmulas;
- P.S/P.V/P.F;
- CA e derivados;
- todas as perícias visíveis na ficha;
- inventário;
- Karma;
- níveis e estágios de Essência;
- técnicas principais de combate;
- textos longos de Habilidades Exclusivas, Personificação do Caos, Habilidades do Caos, Azrakiel, Yamato, Bankais, Itens, Essência e blocos da classe Espadachim.

A planilha continua sendo útil como referência, mas depois de o banco estar configurado o site passa a ser a fonte de dados que você pode continuar modificando.

## Segurança importante

A `supabaseKey` de `js/config.js` é uma chave pública própria para aplicações frontend. **Nunca** coloque a `service_role` no site.

A `access_key` de Thaloria funciona como um segredo compartilhado e deve ficar apenas no link usado por quem poderá editar as fichas.

Se essa chave vazar, gere uma nova diretamente no banco:

```sql
update public.rpg_systems
set access_key = gen_random_uuid()
where slug = 'thaloria'
returning access_key;
```

Todos os links antigos deixam de funcionar imediatamente.
