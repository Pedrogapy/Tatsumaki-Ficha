# Tatsumaki — Ficha Interativa (GitHub Pages)

Este projeto é um site estático (HTML/CSS/JS) que lê a ficha em `data/character.json` e entrega:
- visão geral da ficha
- atributos
- perícias com botão de rolagem (1d20 + total)
- habilidades (texto + uma “árvore de combate” com rolagem de ataque)
- rolador livre (ex: `2d6+3`, `1d20 + @skills.physical.Lutar.total`)
- log copiável

## Como publicar no GitHub Pages (gratuito)

1) Crie um repositório no GitHub (ex: `tatsumaki-ficha`).
2) Suba os arquivos desta pasta (precisa ter `index.html` na raiz).
3) No GitHub, vá em **Settings** → **Pages**.
4) Em **Build and deployment**, selecione:
   - Source: **Deploy from a branch**
   - Branch: `main` (ou `master`) / `(root)`
5) Salve. Depois disso, o GitHub vai te dar o link do site.

## Rodar localmente (recomendado para testes)

Se você abrir o `index.html` direto no navegador, o `fetch` do JSON pode falhar por segurança.
O jeito simples é rodar um servidor local:

- Windows / Linux / macOS (com Python):
  - `python -m http.server 8000`
  - abra `http://localhost:8000`

## Editar a ficha

Abra `data/character.json` e ajuste:
- atributos, perícias, stats, etc.
- `actions` para criar botões rápidos

Exemplo de action:
```json
{ "name": "Teste: Furtividade", "category": "Perícia", "roll": "1d20 + @skills.physical.Furtividade.total" }
```

## Macros disponíveis

- Atributos: `@attributes.Força.value`, `@attributes.Destreza.eighth`, etc.
- Perícias físicas: `@skills.physical.Lutar.total`
- Perícias intelectuais: `@skills.intellectual.Alquimia.total`

## Próximo upgrade (se você quiser)

- separar “habilidades exclusivas” em itens clicáveis, em vez de texto
- adicionar dano + custo de recurso para cada habilidade
- adicionar vantagem/desvantagem no rolador
