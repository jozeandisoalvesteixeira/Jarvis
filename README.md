# Jarvis

Assistente pessoal por voz do Joze, no estilo do Jarvis do Homem de Ferro.
Você toca na esfera e conversa falando, ao vivo. O Jarvis responde com voz e
mostra a legenda na tela.

Projeto separado do CRM: não altera nada no `crmdesvinculeja`.

## Como funciona

- `public/`: a tela (esfera animada, legendas, botões). Pode ser instalada no
  celular como app (Adicionar à Tela de Início).
- `api/session.js`: confere a senha e cria um token temporário (1 uso) para a
  voz ao vivo do **Gemini Live** (Google). A chave de verdade fica só no servidor.
  Escolhe sozinho o melhor modelo de voz ao vivo disponível para a chave.
- `public/mic-worklet.js`: converte o som do microfone para o formato do Gemini.
- `api/_persona.js`: quem o Jarvis é, como fala e o que sabe sobre a
  Desvincule Já. Edite aqui para mudar a personalidade.

## App de iPhone (grátis, por sideload)

- `ios/` e `capacitor.config.json`: o app nativo é uma "casca" que abre o site
  do Jarvis. Assim, toda mudança no site chega ao app sem reinstalar. No app,
  o som e o microfone funcionam sem precisar tocar na tela.
- `.github/workflows/app-iphone.yml`: gera o `Jarvis.ipa` (sem assinatura) num
  Mac do GitHub. Rode em GitHub > Actions > App iPhone > Run workflow e baixe o
  arquivo em "Artifacts".
- Instale no iPhone com o **Sideloadly** (Windows ou Mac), usando o seu Apple
  ID grátis. Contas grátis: o app vale 7 dias e precisa ser reinstalado (ou
  renovado pelo AltStore).

## Variáveis na Vercel (Settings > Environment Variables)

| Nome | O que é |
|---|---|
| `GEMINI_API_KEY` | Chave grátis do Google AI Studio (aistudio.google.com > Get API key) |
| `JARVIS_SENHA` | Senha que você digita no app na primeira vez |
| `JARVIS_VOZ` | Opcional. Padrão `Charon`. Outras: `Puck`, `Fenrir`, `Orus`, `Kore`, `Aoede` |
| `JARVIS_MODELO` | Opcional. Força um modelo específico do Gemini Live |

## Custos e privacidade

O plano grátis do Gemini tem limite de uso diário e o Google pode usar as
conversas para melhorar os produtos dele. Antes de ligar dados de clientes
(CRM), ative o faturamento na chave: no plano pago os dados não são usados.

## Verificação

`npm run check` confere a sintaxe dos arquivos.
