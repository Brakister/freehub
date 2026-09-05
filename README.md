# Freehub

Voz estilo Discord: servidor Socket.IO + WebRTC mesh + desktop Electron.

- Salas de voz com código de 6 caracteres (até 6 pessoas)
- WebRTC P2P (mesh) com STUN público
- Indicador de quem está falando (VAD local + remoto)
- Compartilhamento de tela com **áudio do sistema** e opções de qualidade (720p→4K)
- Mudo, volumes, teste de microfone, servidor de voz configurável
- Auto-update via GitHub Releases
- O instalador **já embute o servidor**: é só abrir o app (ouve em `localhost:3001`)

## Estrutura

```
packages/shared   tipos, eventos, validação (bundle ESM)
packages/webrtc   WebRTC: VAD, mic test, volume, PeerManager mesh
packages/ui       Sidebar, VoicePanel, SettingsModal, store de settings
apps/server       Express + Socket.IO + SQLite (porta 3001) — standalone via npm
apps/desktop      Electron + Vite + React + zustand + servidor embutido (sql.js)
scripts/          test-server.ts, tunnel.ps1
```

## Usar o instalador

Instale o `Freehub Setup x.y.z.exe` e abra o app: ele inicia sozinho um servidor
de voz em `http://localhost:3001` e conecta. Crie/entre numa sala pelo código.

Para falar com gente de outras redes, veja a próxima seção.

## Rodar em dev

```bash
npm install
npm run dev:server     # servidor de voz em http://localhost:3001
npm run dev:desktop    # Electron + Vite HMR
```

## Conectar pessoas de IPs diferentes (grátis)

O servidor de sinalização precisa estar acessível — não engane com `localhost`.
A forma mais fácil e 100% gratuita é um **túnel Cloudflare** (sem conta, sem
port forwarding):

1. Uma pessoa (o anfitrião) abre o **Freehub** (o servidor embutido sobe sozinho)
   — ou, em dev, rode `npm run dev:server`.
2. Na máquina do anfitrião, exponha a porta 3001 publicamente:
   ```bash
   npm run tunnel:server
   ```
   (O script baixa o `cloudflared.exe` sozinho. Sem npm? Baixe o binário do
   Cloudflare e rode `cloudflared tunnel --url http://localhost:3001`.)
3. Copie a URL `https://xxxx.trycloudflare.com` impressa pelo túnel.
4. Cada pessoa, de qualquer rede, abre o Freehub →
   **Configurações → Servidor de voz (URL)** → cola a URL → a conexão é refeita
   automaticamente e ela entra com o código da sala.

Observações:
- A URL `trycloudflare.com` muda a cada reinício do túnel. Para uma URL fixa,
  crie um túnel nomeado no painel da Cloudflare (grátis) ou use um VPS free-tier.
- O áudio é P2P via STUN: funciona na maioria das conexões residenciais. Em
  NATs muito restritivos/firewalls corporativos pode ser preciso adicionar um
  TURN (ex.: Cloudflare Calls) no futuro.

## Servidor público grátis no Render

O arquivo `render.yaml` configura o servidor de sinalização como um Web Service
gratuito no Render. No painel do Render, escolha **New > Blueprint**, conecte o
repositório e confirme o blueprint. Depois do deploy, copie a URL HTTPS gerada
e informe essa URL em **Configurações > Servidor de voz** no Freehub.

O plano gratuito pode dormir após um período sem uso, então a primeira conexão
depois de algum tempo pode demorar alguns segundos.

## Build e release

```bash
npm run build
npm run lint
npm run test:server
npm run electron:build --workspace=apps/desktop -- --publish always
```

O instalador (NSIS Windows, sem assinatura) e o `latest.yml` (feed do
auto-update) vão para uma GitHub Release na tag da versão.