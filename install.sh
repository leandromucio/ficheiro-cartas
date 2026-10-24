#!/usr/bin/env bash
# Fichário de Cartas — instalador para servidor próprio (Debian/Ubuntu).
# Uso:  curl -fsSL https://raw.githubusercontent.com/leandromucio/ficheiro-cartas/main/install.sh | sudo bash -s cartas.arcalli.com.br
# Rodar de novo atualiza o app sem perder dados.
set -euo pipefail

DOMAIN="${1:-cartas.arcalli.com.br}"
REPO="https://github.com/leandromucio/ficheiro-cartas.git"
SRC=/opt/fichario
DATA=/opt/fichario-data
ENVF=/opt/fichario.env
NAME=fichario
PORT=3077

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✘ %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Rode como root (use sudo)."

say "1/6 Verificando dependências"
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
if ! command -v docker >/dev/null; then
  warn "Docker não encontrado — instalando"
  curl -fsSL https://get.docker.com | sh
fi
ok "git e docker prontos"

say "2/6 Baixando o código"
if [ -d "$SRC/.git" ]; then git -C "$SRC" fetch -q origin && git -C "$SRC" reset -q --hard origin/main; else git clone -q "$REPO" "$SRC"; fi
ok "código em $SRC ($(git -C "$SRC" rev-parse --short HEAD))"

say "3/6 Configuração"
mkdir -p "$DATA" && chown -R 1000:1000 "$DATA"
if [ ! -f "$ENVF" ]; then
  KEY="${ANTHROPIC_API_KEY:-}"
  if [ -z "$KEY" ] && [ -r /dev/tty ]; then
    printf 'Cole a sua chave da API da Anthropic (começa com sk-ant-, não aparece na tela; Enter para pular): ' > /dev/tty
    IFS= read -rs KEY < /dev/tty || true; echo > /dev/tty
  fi
  INV=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n' | tr a-f A-F)
  umask 077
  cat > "$ENVF" <<EOF
SECRET=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
ANTHROPIC_API_KEY=$KEY
INVITE_CODE=$INV
EOF
  ok "configuração criada em $ENVF (permissão 600)"
else
  ok "configuração existente mantida ($ENVF)"
fi

say "4/6 Construindo e iniciando o app"
docker build -q -t fichario "$SRC/server" >/dev/null
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
  --env-file "$ENVF" -v "$DATA":/data \
  -p 127.0.0.1:$PORT:3077 fichario >/dev/null
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null || { docker logs "$NAME" | tail -20; die "o app não subiu"; }
ok "app rodando em 127.0.0.1:$PORT"

say "5/6 Publicando em https://$DOMAIN"
PROXY=none
listener() { ss -ltnp 2>/dev/null | grep -E "[:.]$1 " | head -1 || true; }
L443="$(listener 443)"; L80="$(listener 80)"
if   echo "$L443$L80" | grep -q nginx;   then PROXY=nginx
elif echo "$L443$L80" | grep -q caddy;   then PROXY=caddy
elif echo "$L443$L80" | grep -q docker-proxy; then
  if docker ps --format '{{.Image}} {{.Names}}' | grep -qi traefik; then PROXY=traefik
  elif docker ps --format '{{.Image}} {{.Names}}' | grep -qi caddy; then PROXY=caddy-docker
  elif docker ps --format '{{.Image}} {{.Names}}' | grep -qiE 'nginx-proxy-manager|jc21'; then PROXY=npm
  elif docker ps --format '{{.Image}} {{.Names}}' | grep -qi nginx; then PROXY=nginx-docker
  else PROXY=docker-unknown; fi
elif [ -n "$L443$L80" ]; then PROXY=unknown
fi
echo "proxy detectado: $PROXY"

case "$PROXY" in
  nginx)
    CONF=/etc/nginx/sites-available/fichario
    [ -d /etc/nginx/sites-available ] || CONF=/etc/nginx/conf.d/fichario.conf
    cat > "$CONF" <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 120s;
  }
}
EOF
    [ -d /etc/nginx/sites-enabled ] && ln -sf "$CONF" /etc/nginx/sites-enabled/fichario
    nginx -t && systemctl reload nginx
    command -v certbot >/dev/null || { apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx; }
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
      && ok "HTTPS ativo" || warn "certbot falhou: confira se o DNS de $DOMAIN aponta para este servidor e rode o instalador de novo"
    ;;
  caddy)
    CF=/etc/caddy/Caddyfile
    if ! grep -q "$DOMAIN" "$CF" 2>/dev/null; then
      printf '\n%s {\n  request_body { max_size 12MB }\n  reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" >> "$CF"
    fi
    caddy validate --config "$CF" >/dev/null && systemctl reload caddy && ok "Caddy configurado (HTTPS automático)"
    ;;
  none)
    docker rm -f fichario-caddy >/dev/null 2>&1 || true
    mkdir -p /opt/fichario-caddy
    printf '%s {\n  request_body { max_size 12MB }\n  reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" > /opt/fichario-caddy/Caddyfile
    docker run -d --name fichario-caddy --restart unless-stopped --network host \
      -v /opt/fichario-caddy/Caddyfile:/etc/caddy/Caddyfile -v fichario-caddy-data:/data caddy:2-alpine >/dev/null
    ok "Caddy instalado nas portas 80/443 (HTTPS automático)"
    ;;
  *)
    warn "Já existe um proxy ($PROXY) nas portas 80/443 que eu não configuro sozinho."
    warn "Aponte $DOMAIN para http://127.0.0.1:$PORT nele (ou para http://172.17.0.1:$PORT se o proxy roda em Docker),"
    warn "com limite de upload de 12 MB. Depois teste https://$DOMAIN"
    ;;
esac

say "6/6 Pronto"
INV=$(grep '^INVITE_CODE=' "$ENVF" | cut -d= -f2)
grep -q '^ANTHROPIC_API_KEY=.\+' "$ENVF" || warn "Scan desativado: falta a chave da Anthropic. Edite $ENVF (ANTHROPIC_API_KEY=...) e rode: docker restart $NAME"
cat <<EOF

  App:       https://$DOMAIN
  Dados:     $DATA   (faça backup desta pasta)
  Convite:   $INV    (para outras pessoas criarem conta; a 1ª conta é livre)
  Atualizar: rode o mesmo comando de instalação de novo
  Logs:      docker logs -f $NAME
  Trocar senha de alguém:
             docker exec $NAME node server.mjs reset-password email@exemplo.com novaSenha

EOF
