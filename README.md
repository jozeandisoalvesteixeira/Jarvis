# Jarvis

Assistente pessoal por voz do Joze, no estilo do Jarvis do Homem de Ferro.
Você toca na esfera e conversa falando, ao vivo. O Jarvis responde com voz e
mostra a legenda na tela.

Projeto separado do CRM: não altera nada no `crmdesvinculeja`.

## Como funciona

- `public/`: a tela (esfera animada, legendas, botões). Pode ser instalada no
  celular como app (Adicionar à Tela de Início).
- `api/session.js`: confere a senha e cria uma chave temporária de 10 minutos
  para a voz em tempo real da OpenAI. A chave de verdade fica só no servidor.
- `api/_persona.js`: quem o Jarvis é, como fala e o que sabe sobre a
  Desvincule Já. Edite aqui para mudar a personalidade.

## Variáveis na Vercel (Settings > Environment Variables)

| Nome | O que é |
|---|---|
| `OPENAI_API_KEY` | Chave da OpenAI (platform.openai.com > API keys) |
| `JARVIS_SENHA` | Senha que você digita no app na primeira vez |
| `JARVIS_VOZ` | Opcional. Padrão `cedar`. Outras: `marin`, `ash`, `ballad`, `echo`, `sage`, `verse` |
| `JARVIS_MODELO` | Opcional. Padrão `gpt-realtime` |

## Custos

A voz em tempo real da OpenAI é paga por uso. Coloque um limite mensal em
platform.openai.com > Settings > Limits.

## Verificação

`npm run check` confere a sintaxe dos arquivos.
