// Cria uma chave temporária (vale 10 min) para o navegador falar direto com a
// voz em tempo real da OpenAI. A chave de verdade (OPENAI_API_KEY) nunca sai do
// servidor. A senha (JARVIS_SENHA) impede que estranhos gastem o seu crédito.

import { timingSafeEqual } from "node:crypto";
import { instrucoes } from "./_persona.js";

const MODELO = process.env.JARVIS_MODELO || "gpt-realtime";
const VOZ = process.env.JARVIS_VOZ || "cedar";

function senhaConfere(digitada, certa) {
  const a = Buffer.from(String(digitada ?? ""));
  const b = Buffer.from(String(certa));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

  const senha = process.env.JARVIS_SENHA;
  const chave = process.env.OPENAI_API_KEY;
  if (!senha || !chave) {
    return res.status(500).json({ erro: "Configuração incompleta: faltam JARVIS_SENHA ou OPENAI_API_KEY na Vercel." });
  }

  let corpo = req.body ?? {};
  if (typeof corpo === "string") {
    try { corpo = JSON.parse(corpo || "{}"); } catch { corpo = {}; }
  }
  if (!senhaConfere(corpo.senha, senha)) return res.status(401).json({ erro: "Senha incorreta." });

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: MODELO,
        instructions: instrucoes(),
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe", language: "pt" },
            turn_detection: { type: "semantic_vad" },
          },
          output: { voice: VOZ },
        },
      },
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.value) {
    return res.status(502).json({ erro: j?.error?.message || `A OpenAI recusou (${r.status}).` });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ token: j.value, modelo: MODELO });
}
