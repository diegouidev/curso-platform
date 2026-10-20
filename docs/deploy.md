# Deploy na VPS (Ubuntu) com Cloudflare Tunnel

Endereço: **https://cursos.diegodev.app.br**

```
Navegador ──HTTPS──► Cloudflare (Access: só o seu e-mail) ──túnel──► cloudflared (VPS)
                                                                        │
                                       127.0.0.1:3100 ◄─────────────────┘
                                       frontend (Next.js) ──/api──► backend (Django) ──► SQLite (volume)
```

- **Nenhuma porta é aberta na VPS.** O `cloudflared` conecta de dentro para fora. O frontend
  escuta só em `127.0.0.1:3100` e o backend nem publica porta: o navegador fala apenas com o
  frontend, que repassa `/api` pela rede interna do Docker.
- Esta máquina continua com o túnel da sua outra aplicação; só ganha um hostname a mais.

Siga na ordem. Os comandos de VPS rodam no terminal SSH da VPS; os de PC, no seu computador.

---

## 1. Google Cloud: publicar o app OAuth

No [Google Cloud Console](https://console.cloud.google.com/), no projeto que você criou pelo
[docs/google-oauth.md](google-oauth.md):

1. **APIs e serviços → Credenciais →** abra o cliente OAuth "Aplicativo da Web".
2. Em **URIs de redirecionamento autorizados**, clique em **Adicionar URI** e cole
   exatamente:

   ```
   https://cursos.diegodev.app.br/api/google/callback
   ```

   Mantenha o `http://localhost:8000/api/google/callback` para continuar desenvolvendo no PC.
   Salve.
3. **Tela de consentimento OAuth** (no console novo: **Google Auth Platform → Público-alvo**):
   clique em **Publicar app** e confirme. O status passa de "Teste" para **"Em produção"**.
   **Não envie para verificação**: para uso pessoal não é necessário (e a verificação do
   escopo `drive.readonly` exige auditoria paga).

Com o app em produção, o acesso ao Drive deixa de expirar a cada 7 dias. Ao conectar, o
Google mostra **"O Google não verificou este app"**: clique em **Avançado → Acessar
(não seguro)**. É o seu próprio app.

Não tem custo: a Drive API e o OAuth são gratuitos e o projeto não precisa de faturamento.

---

## 2. VPS: preparar o servidor

### 2.1 Docker e ferramentas

Veja se o Docker já existe:

```bash
docker compose version
```

Se o comando não existir, instale pelo repositório oficial:

```bash
sudo apt update && sudo apt install -y ca-certificates curl git make
```

```bash
sudo install -m 0755 -d /etc/apt/keyrings && sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Use o Docker sem `sudo` (depois **saia e entre de novo** no SSH):

```bash
sudo usermod -aG docker $USER
```

Se o Docker já estava instalado, garanta só o `git` e o `make`:

```bash
sudo apt install -y git make
```

### 2.2 Memória para o build (VPS com 2 GB de RAM ou menos)

O build do Next.js usa bastante memória. Veja quanto há livre:

```bash
free -h
```

Se houver menos de 2 GB disponíveis e nenhum swap, crie 2 GB de swap:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2.3 Baixar o código

```bash
sudo mkdir -p /opt/curso-platform && sudo chown "$USER": /opt/curso-platform
```

```bash
git clone https://github.com/diegouidev/curso-platform.git /opt/curso-platform && cd /opt/curso-platform
```

### 2.4 Configurar o `.env`

```bash
cp .env.production.example .env && chmod 600 .env
```

Gere a chave do Django:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

Abra o arquivo:

```bash
nano .env
```

Preencha:

| Variável | Valor |
| --- | --- |
| `DJANGO_SECRET_KEY` | a chave gerada acima |
| `FIELD_ENCRYPTION_KEY` | **copie a do `.env` do seu PC** (a mesma chave abre o token do Google que vem no banco) |
| `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` | os mesmos do `.env` do PC |
| `APP_PORT` | `3100` (troque se já estiver em uso; veja abaixo) |

O resto já vem certo para `https://cursos.diegodev.app.br`. Para conferir se a porta está livre
(sem saída = livre):

```bash
ss -ltn | grep ':3100 '
```

### 2.5 Trazer os seus dados do PC

O pacote com tudo o que você tem hoje (cursos, progresso, anotações, títulos editados,
capas e a conexão com o Google) já foi gerado no PC em
`backups/curso-platform-20261019-213448.tar.gz`.

> Gere um novo logo antes de migrar se você continuou estudando no PC depois disso, e
> depois da migração use só a VPS (os dois bancos não se sincronizam). No PC, com o Docker
> rodando: `scripts/backup.sh docker-compose.yml` (no WSL) ou, no Git Bash do Windows,
> `MSYS_NO_PATHCONV=1 bash scripts/backup.sh docker-compose.yml`.

Na VPS, crie a pasta:

```bash
mkdir -p /opt/curso-platform/backups
```

No PC (PowerShell), envie o arquivo (troque `usuario` e `IP_DA_VPS`):

```powershell
scp "C:\Users\Colégio\curso-platform\backups\curso-platform-20261019-213448.tar.gz" usuario@IP_DA_VPS:/opt/curso-platform/backups/
```

### 2.6 Subir a aplicação

Na VPS, em `/opt/curso-platform`. Construa as imagens (alguns minutos):

```bash
docker compose -f docker-compose.prod.yml build
```

Coloque os dados no volume (cria o volume, extrai o banco e as capas, ajusta permissões):

```bash
make prod-restore FILE=backups/curso-platform-20261019-213448.tar.gz
```

Suba tudo:

```bash
make prod-up
```

Confira localmente (deve responder `HTTP/1.1 200 OK`):

```bash
curl -sI http://127.0.0.1:3100/login | head -1
```

> **Instalação nova, sem dados do PC?** Pule o `prod-restore`, rode `make prod-up` e crie o
> usuário com `make prod-createsuperuser`.

---

## 3. Cloudflare

### 3.1 Apontar o subdomínio para o túnel

Descubra como o seu `cloudflared` foi configurado:

```bash
systemctl cat cloudflared | grep ExecStart
```

- Tem `--token` → túnel **gerenciado pelo painel**: siga a opção A.
- Tem `--config` (ou ele lê `/etc/cloudflared/config.yml`) → túnel **por arquivo**: opção B.

**A) Pelo painel (Zero Trust)**

1. Acesse [one.dash.cloudflare.com](https://one.dash.cloudflare.com/) → **Networks → Tunnels**
   e abra o túnel que já serve a sua outra aplicação.
2. Aba **Public Hostname** (em contas novas: **Published application routes**) → **Add a
   public hostname**:
   - **Subdomain:** `cursos`
   - **Domain:** `diegodev.app.br`
   - **Path:** (vazio)
   - **Service → Type:** `HTTP` · **URL:** `localhost:3100`
3. **Save**. O registro DNS (CNAME para o túnel) é criado sozinho.

**B) Pelo arquivo `config.yml`**

Edite o arquivo:

```bash
sudo nano /etc/cloudflared/config.yml
```

Adicione a regra **antes** da última linha (o `http_status:404` precisa continuar no fim):

```yaml
ingress:
  - hostname: cursos.diegodev.app.br
    service: http://localhost:3100
  # ... as regras da sua outra aplicação continuam aqui ...
  - service: http_status:404
```

Valide e crie o DNS (troque `NOME_DO_TUNEL`; `cloudflared tunnel list` mostra o nome):

```bash
cloudflared tunnel ingress validate
```

```bash
cloudflared tunnel route dns NOME_DO_TUNEL cursos.diegodev.app.br
```

```bash
sudo systemctl restart cloudflared
```

> **O `cloudflared` roda em container?** Aí `localhost` é o próprio container. Ou rode-o com
> `network_mode: host`, ou conecte-o à rede do app
> (`docker network connect curso-platform_default NOME_DO_CONTAINER`) e use
> `http://frontend:3000` como serviço.

### 3.2 Cloudflare Access: só o seu e-mail entra

Antes da tela de login do app, a Cloudflare pede um código enviado ao seu e-mail. Gratuito
até 50 usuários.

1. No Zero Trust: **Access → Applications → Add an application → Self-hosted**.
2. **Application name:** `Estudos` · **Session duration:** `1 month`.
3. **Public hostname / Application domain:** subdomínio `cursos`, domínio
   `diegodev.app.br`, path vazio.
4. **Policy:** nome `Só eu`, **Action** `Allow`, **Include → Emails** →
   `diegocoelho44@gmail.com`.
5. **Login methods:** deixe **One-time PIN** (código por e-mail). Salve.

O retorno do Google (`/api/google/callback`) passa pelo Access normalmente, porque é o seu
próprio navegador. Se a sessão do Access expirar com a página aberta, as ações começam a
falhar: recarregue a página e confirme o código de novo.

### 3.3 Ajustes do domínio

No painel do domínio `diegodev.app.br` ([dash.cloudflare.com](https://dash.cloudflare.com/)):

1. **SSL/TLS → Edge Certificates → Always Use HTTPS:** `On`.
2. **Rules → Configuration Rules → Create rule:**
   - **When:** *Hostname* `equals` `cursos.diegodev.app.br`
   - **Then:** **Rocket Loader** `Off` e **Email Obfuscation** `Off`
   - Motivo: os dois reescrevem os scripts da página, e a política de segurança (CSP) do app
     bloqueia scripts injetados.

Nada de cache para configurar: o padrão da Cloudflare já faz o certo (arquivos estáticos do
Next ficam em cache; as capas e a API respondem como privadas e não são guardadas).

---

## 4. Primeiro acesso

1. Abra **https://cursos.diegodev.app.br**, informe seu e-mail no Access e o código recebido.
2. Entre no app com o seu usuário (`admin` e a senha de sempre).
3. **Configurações → Conta Google → Reconectar**. Isso gera um acesso do app já publicado,
   que não expira mais. Na tela "Google não verificou este app": **Avançado → Acessar**.
4. Abra uma aula e confira se o vídeo toca. O navegador precisa estar logado na conta Google
   com acesso às pastas.
5. Troque a senha (pede a nova duas vezes):

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py changepassword admin
```

---

## 5. Backups automáticos

`make prod-backup` grava em `backups/` uma cópia consistente do banco e das capas (pode rodar
com o app no ar) e mantém as 14 mais recentes. Para rodar todo dia às 3h30:

```bash
crontab -e
```

Adicione a linha:

```
30 3 * * * cd /opt/curso-platform && scripts/backup.sh docker-compose.prod.yml >> backups/backup.log 2>&1
```

De vez em quando, copie um backup para fora da VPS (no PC, PowerShell):

```powershell
scp usuario@IP_DA_VPS:/opt/curso-platform/backups/curso-platform-*.tar.gz .
```

Restaurar um backup: `make prod-restore FILE=backups/curso-platform-AAAAMMDD-HHMMSS.tar.gz`.
Também existe o backup em JSON (progresso e anotações) em **Configurações → Meus dados**.

---

## 6. Atualizar para uma versão nova

```bash
cd /opt/curso-platform && git pull && make prod-up
```

O `make prod-up` **se recusa a reiniciar enquanto uma importação ou sincronização estiver
rodando** (reiniciar interromperia a importação). Espere terminar e rode de novo.

---

## 7. Problemas comuns

| Sintoma | Causa e solução |
| --- | --- |
| Erro 502 ou 1033 da Cloudflare | O túnel não alcança `127.0.0.1:3100`. Veja `docker compose -f docker-compose.prod.yml ps`, `curl -sI http://127.0.0.1:3100/login` e `journalctl -u cloudflared -n 50`. |
| `redirect_uri_mismatch` ao conectar o Google | O URI do passo 1 não está cadastrado exatamente igual (https, sem barra no fim). |
| "Reconectar Google" toda semana | O app OAuth continua em "Teste": publique (passo 1.3) e reconecte uma vez. |
| Login não "segura" (volta para a tela de login) | Com `AUTH_COOKIE_SECURE=true` o cookie só funciona em HTTPS: acesse pelo domínio, não por `http://127.0.0.1:3100`. |
| O build para com "Killed" | Falta de memória: crie o swap (passo 2.2). |
| Importação parou no meio | O backend reiniciou durante ela. Em até 10 minutos ela é marcada como interrompida; depois clique em **Sincronizar**. |
| Ver o que está acontecendo | `make prod-logs` |
