# Freehub

Voz estilo Discord: servidor Socket.IO + WebRTC mesh + desktop Electron.

- Salas de voz com código de 6 caracteres (até 6 pessoas)
- WebRTC P2P (mesh) com STUN público
- Indicador de quem está falando (VAD local + remoto)
- Compartilhamento de tela, mudo, volumes, teste de microfone
- Auto-update via GitHub Releases

## Estrutura

```
packages/shared   tipos, eventos, validação (bundle ESM)
packages/webrtc   WebRTC: VAD, mic test, volume, PeerManager mesh
packages/ui       Sidebar, VoicePanel, SettingsModal, store de settings
apps/server       Express + Socket.IO + SQLite (porta 3001)
apps/desktop      Electron + Vite + React + zustand
scripts/          test-server.ts, tunnel.ps1
```

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

1. Rode o servidor numa máquina:
   ```bash
   npm run dev:server
   ```
2. Nessa mesma máquina (outro terminal), publique a porta 3001 publicamente:
   ```bash
   npm run tunnel:server
   ```
3. Copie a URL `https://xxxx.trycloudflare.com` impressa pelo túnel.
4. Cada pessoa (em casa, em outra rede) abre o Freehub →
   **Configurações → Servidor de voz (URL)** → cola a URL → a conexão é refeita
   automaticamente e ela pode entrar com o código da sala.

Observações:
- A URL `trycloudflare.com` muda a cada reinício do túnel. Para uma URL fixa,
  crie um túnel nomeado no painel da Cloudflare (grátis) ou use um VPS free-tier.
- O áudio é P2P via STUN: funciona na maioria das conexões residenciais. Em
  NATs muito restritivos/firewalls corporativos pode ser preciso adicionar um
  TURN (ex.: Cloudflare Calls) no futuro.

## Build e release

```bash
npm run build
npm run lint
npm run test:server
npm run electron:build --workspace=apps/desktop -- --publish always
```

O instalador (NSIS Windows, sem assinatura) e o `latest.yml` (feed do
auto-update) vão para uma GitHub Release na tag da versão.