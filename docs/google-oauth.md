# Conectar o Google Drive (OAuth)

A plataforma lê o Drive **com a sua própria conta Google**, usando somente o escopo
`https://www.googleapis.com/auth/drive.readonly`. Ela não usa service account, nunca
escreve no Drive e não baixa vídeos.

Para isso, você precisa criar uma credencial OAuth no Google Cloud. Faz isso uma vez só e
leva uns 10 minutos.

> Os nomes dos menus abaixo seguem o console atual ("Google Auth Platform"). Em consoles
> mais antigos, os mesmos itens ficam em **APIs e serviços → Tela de permissão OAuth** e
> **APIs e serviços → Credenciais**.

---

## 1. Criar um projeto

1. Acesse https://console.cloud.google.com/ logado com **a conta que tem acesso às aulas**
   (`diegocoelho44@gmail.com`). Pode ser outra conta, mas assim fica mais simples.
2. No seletor de projetos (barra superior), clique em **Novo projeto**.
3. Nome: `curso-platform`. Clique em **Criar** e selecione o projeto criado.

## 2. Ativar a Google Drive API

1. Menu ☰ → **APIs e serviços → Biblioteca**.
2. Procure **Google Drive API** e clique em **Ativar**.

> Se este passo for pulado, a conexão falha com a mensagem "A Google Drive API não está
> ativada no projeto".

## 3. Configurar a tela de consentimento

1. Menu ☰ → **Google Auth Platform → Visão geral → Começar** (ou *Get started*).
2. **Informações do app:** nome `Curso Platform`; e-mail de suporte: o seu.
3. **Público-alvo:** **Externo**.
4. **Dados de contato:** o seu e-mail. Aceite a política e clique em **Criar**.

### 3.1 Adicionar você como usuário de teste

1. **Google Auth Platform → Público-alvo**.
2. O status de publicação deve estar em **Teste**.
3. Em **Usuários de teste**, clique em **Adicionar usuários** e informe
   `diegocoelho44@gmail.com`. Salve.

> Em modo de teste, **só os usuários de teste conseguem autorizar o app**. Ninguém mais
> consegue usá-lo.

### 3.2 (Opcional) Declarar o escopo

**Google Auth Platform → Acesso a dados → Adicionar ou remover escopos**, marque
`.../auth/drive.readonly` e salve. Não é obrigatório em modo de teste, mas deixa
explícito o que o app pede.

## 4. Criar a credencial OAuth

1. **Google Auth Platform → Clientes → Criar cliente**.
2. Tipo de aplicativo: **Aplicativo da Web**.
3. Nome: `curso-platform-local`.
4. **URIs de redirecionamento autorizados → Adicionar URI**:

   ```
   http://localhost:8000/api/google/callback
   ```

   O endereço precisa ser exatamente este: `http`, porta 8000 e sem barra no final. Não
   é preciso preencher "Origens JavaScript autorizadas".
5. Clique em **Criar**. Copie o **ID do cliente** e a **Chave secreta do cliente**.

> A chave secreta só aparece por completo nessa hora. Se perder, crie uma nova no mesmo
> cliente.

## 5. Configurar o `.env`

No `.env` da raiz do projeto:

```dotenv
GOOGLE_CLIENT_ID=123456789-abc...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:8000/api/google/callback
```

Reinicie o backend (`make dev` ou `make up`). **Nunca** commite esses valores: o `.env` já
está no `.gitignore`.

## 6. Conectar pela plataforma

1. Entre em http://localhost:3000 e vá em **Configuração inicial** (ou **Configurações**).
2. Clique em **Conectar Google** e escolha a conta com acesso às aulas.
3. Vai aparecer a tela "O Google não verificou este app". Isso é esperado, porque o app
   é seu e não passou pela verificação pública. Clique em **Continuar**.
4. Confirme a permissão **"Ver e baixar todos os seus arquivos do Google Drive"**. Esse é
   o texto padrão do Google para o escopo `drive.readonly`: o app não baixa nada, só lê
   nomes e a estrutura das pastas. **Deixe a caixa marcada**; sem ela, a conexão é recusada.
5. Você volta para a plataforma com a conta conectada.

---

## Renovação e "Reconectar Google"

- O access token dura cerca de 1 hora e é renovado automaticamente pelo refresh token.
- Os dois tokens ficam **criptografados** no banco (Fernet, chave `FIELD_ENCRYPTION_KEY`).
- Se o Google recusar o refresh token, a plataforma mostra o aviso **Reconectar Google**.
  Basta clicar e autorizar de novo. Progresso, anotações e cursos não são afetados.

### ⚠️ Modo de teste: o refresh token expira em 7 dias

Enquanto o app estiver com status **Teste**, o Google invalida o refresh token **7 dias**
depois da autorização. Na prática, você vai ver "Reconectar Google" uma vez por semana.

Para evitar isso:

1. **Google Auth Platform → Público-alvo → Publicar app** (status **Em produção**).
2. Para uso pessoal (menos de 100 usuários), **não é preciso passar pela verificação**.
   O Google continua mostrando a tela "app não verificado" na autorização, e o limite é
   de 100 usuários. Com o app publicado, o refresh token deixa de expirar em 7 dias.

Publicar não torna nada público: ninguém acessa seu Drive. Cada pessoa só autoriza com a
própria conta, e a plataforma só aceita o seu login.

## Desconectar

Em **Configurações → Desconectar**, a plataforma revoga o token no Google e apaga a
credencial local. Os cursos importados, o progresso e as anotações continuam salvos.

Você também pode revogar o acesso pelo lado do Google em
https://myaccount.google.com/connections.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `redirect_uri_mismatch` na tela do Google | O URI do passo 4 está diferente de `GOOGLE_REDIRECT_URI` (http/https, porta, barra no final). |
| `access_denied` / "app em teste" | A conta não está em **Usuários de teste** (passo 3.1). |
| "A Google Drive API não está ativada" | Pule de volta ao passo 2. |
| "A permissão de leitura do Google Drive não foi concedida" | A caixa do Drive foi desmarcada na tela de consentimento. Conecte de novo e deixe-a marcada. |
| "Pasta não encontrada" ao importar | A conta conectada não tem acesso à pasta, ou o link está errado. Confira o e-mail mostrado em Configurações. |
| O vídeo não abre no player | O player usa o embed do Drive, que depende da conta logada **no navegador**, não da conta conectada aqui. Entre no Google com a conta que tem acesso. |
