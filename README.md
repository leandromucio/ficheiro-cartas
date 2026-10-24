# Fichário de Cartas

App pessoal de coleção e trocas de cartas Pokémon (PT-BR): catálogo TCGdex, preços em R$, scan por foto com IA, controle de repetidas e trocas.

## Instalar / atualizar num servidor (Debian/Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/leandromucio/ficheiro-cartas/main/install.sh | sudo bash -s cartas.arcalli.com.br
```

- Pede a chave da API da Anthropic (para o scan) só na primeira vez e guarda em `/opt/fichario.env`.
- Dados ficam em `/opt/fichario-data` (faça backup dessa pasta).
- Detecta Nginx ou Caddy já instalados; se as portas 80/443 estiverem livres, sobe um Caddy com HTTPS automático.

## Estrutura

- `server/server.mjs` — servidor Node 22 sem dependências (login, coleção, fotos, preços, scan).
- `server/public/` — app já compilado.
- `src/` — código-fonte do app (compilar com esbuild, aliasando `@netlify/identity` para `src/auth-self.js`).
