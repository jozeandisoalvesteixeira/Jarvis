// Cria um token temporário (1 uso, 30 min) para o navegador falar direto com a
// voz ao vivo do Gemini (Google). A chave de verdade (GEMINI_API_KEY) nunca sai
// do servidor. A senha (JARVIS_SENHA) impede que estranhos usem a sua cota.

import { timingSafeEqual } from "node:crypto";
import { GoogleGenAI, Modality } from "@google/genai";
import { instrucoes } from "./_persona.js";

const VOZ = process.env.JARVIS_VOZ || "Charon";
let modeloEmCache = process.env.JARVIS_MODELO || null;

function senhaConfere(digitada, certa) {
  const a = Buffer.from(String(digitada ?? ""));
  const b = Buffer.from(String(certa));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Descobre sozinho o melhor modelo de voz ao vivo disponível para a chave,
// preferindo os de "áudio nativo" (voz mais natural).
async function escolherModelo(chave) {
  if (modeloEmCache) return modeloEmCache;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(chave)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `O Google recusou a chave (${r.status}).`);
  const ao_vivo = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("bidiGenerateContent"))
    .map((m) => m.name);
  if (!ao_vivo.length) throw new Error("Nenhum modelo de voz ao vivo disponível para esta chave do Gemini.");
  const nota = (n) => (n.includes("native-audio") ? 4 : 0) + (n.includes("flash") ? 2 : 0) - (n.includes("preview") ? 1 : 0) - (n.includes("thinking") ? 1 : 0);
  modeloEmCache = ao_vivo.sort((a, b) => nota(b) - nota(a) || b.localeCompare(a))[0];
  return modeloEmCache;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

  const senha = process.env.JARVIS_SENHA;
  const chave = process.env.GEMINI_API_KEY;
  if (!senha || !chave) {
    return res.status(500).json({ erro: "Configuração incompleta: faltam JARVIS_SENHA ou GEMINI_API_KEY na Vercel." });
  }

  let corpo = req.body ?? {};
  if (typeof corpo === "string") {
    try { corpo = JSON.parse(corpo || "{}"); } catch { corpo = {}; }
  }
  if (!senhaConfere(corpo.senha, senha)) return res.status(401).json({ erro: "Senha incorreta." });

  try {
    const modelo = await escolherModelo(chave);
    const ai = new GoogleGenAI({ apiKey: chave, httpOptions: { apiVersion: "v1alpha" } });
    const agora = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(agora + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(agora + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: modelo,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: instrucoes(),
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ } } },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    if (!token?.name) throw new Error("O Google não devolveu o token.");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ token: token.name, modelo: modelo.startsWith("models/") ? modelo : `models/${modelo}` });
  } catch (e) {
    modeloEmCache = process.env.JARVIS_MODELO || null; // tenta descobrir de novo na próxima
    return res.status(502).json({ erro: e?.message || "Falha ao falar com o Google." });
  }
}
