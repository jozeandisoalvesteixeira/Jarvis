// Jarvis: conversa por voz ao vivo com o Gemini Live (Google), por WebSocket.
// Fluxo: toque -> pede token temporário ao /api/session -> abre o microfone ->
// conecta -> o Jarvis cumprimenta -> a conversa segue sozinha (dá para interromper).

const $ = (id) => document.getElementById(id);
const el = {
  estado: $("estado"), legenda: $("legenda"), erro: $("erro"), orbe: $("orbe"),
  iniciar: $("btn-iniciar"), mudo: $("btn-mudo"), encerrar: $("btn-encerrar"),
  senhaBox: $("senha-box"), formSenha: $("form-senha"), campoSenha: $("campo-senha"),
};

const CHAVE_SENHA = "jarvis.senha";
const lerSenha = () => { try { return localStorage.getItem(CHAVE_SENHA) || ""; } catch { return ""; } };
const gravarSenha = (s) => { try { s ? localStorage.setItem(CHAVE_SENHA, s) : localStorage.removeItem(CHAVE_SENHA); } catch {} };

const WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

let ws = null, microfone = null, contexto = null, noMic = null, fonteMic = null;
let analisadorMic = null, analisadorVoz = null, saidaVoz = null;
let tocando = new Set(), proximoInicio = 0;
let fase = "parado"; // parado | conectando | ouvindo | pensando | falando
let mudo = false, wakeLock = null, encerrandoDePropósito = false;
let falaJarvis = "", falaVoce = "", novoTurno = true;

const ROTULOS = {
  parado: "Toque na esfera para começar",
  conectando: "Conectando…",
  ouvindo: "Ouvindo",
  pensando: "Pensando",
  falando: "Falando",
};

function mudarFase(f) {
  fase = f;
  el.estado.textContent = mudo && f === "ouvindo" ? "Microfone silenciado" : ROTULOS[f];
  const ativo = f !== "parado";
  el.iniciar.hidden = ativo;
  el.mudo.hidden = !ativo || f === "conectando";
  el.encerrar.hidden = !ativo;
}

function mostrarErro(msg) { el.erro.textContent = msg || ""; }

function mostrarLegenda() {
  el.legenda.textContent = "";
  if (falaVoce) {
    const s = document.createElement("span");
    s.className = "voce";
    s.textContent = "Você: " + falaVoce;
    el.legenda.append(s);
  }
  if (falaJarvis) el.legenda.append(document.createTextNode(falaJarvis));
}

// ---------- Conexão ----------

async function pedirToken() {
  const senha = lerSenha();
  if (!senha) { pedirSenha(); return null; }
  const r = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senha }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { gravarSenha(""); pedirSenha("Senha incorreta. Tente de novo."); return null; }
  if (!r.ok) throw new Error(j.erro || "O servidor do Jarvis não respondeu.");
  return j;
}

async function iniciar() {
  if (fase !== "parado") return;
  mostrarErro("");
  falaJarvis = ""; falaVoce = ""; novoTurno = true; mostrarLegenda();
  encerrandoDePropósito = false;
  mudarFase("conectando");

  // O áudio e o microfone precisam ser ligados logo no toque (regra do iPhone).
  try {
    contexto = contexto || new (window.AudioContext || window.webkitAudioContext)();
    await contexto.resume();
    microfone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (e) {
    encerrar();
    mostrarErro(e?.name === "NotAllowedError"
      ? "O microfone foi bloqueado. Libere em Ajustes › Safari › Microfone e tente de novo."
      : "Não consegui ligar o microfone deste aparelho.");
    return;
  }

  try {
    await prepararAudio();
    const sessao = await pedirToken();
    if (!sessao) { encerrar(); return; }
    conectar(sessao);
  } catch (e) {
    encerrar();
    mostrarErro(e?.message || "Não consegui conectar. Tente de novo.");
  }
}

function conectar({ token, modelo }) {
  ws = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(token)}`);
  ws.onopen = () => enviar({ setup: { model: modelo } });
  ws.onmessage = async (ev) => {
    try {
      const texto = typeof ev.data === "string" ? ev.data : await ev.data.text();
      tratarMensagem(JSON.parse(texto));
    } catch {}
  };
  ws.onerror = () => {};
  ws.onclose = (ev) => {
    if (encerrandoDePropósito || fase === "parado") return;
    encerrar();
    mostrarErro(ev.reason ? `A conexão foi encerrada: ${ev.reason}` : "A conexão caiu. Toque para falar de novo.");
  };
}

function enviar(obj) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

function tratarMensagem(m) {
  if (m.setupComplete) {
    mudarFase("pensando");
    // Liga o envio do microfone e pede o cumprimento inicial.
    noMic.port.onmessage = (ev) => { if (!mudo) enviarAudio(ev.data); };
    enviar({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: "(O Joze acabou de abrir o app. Cumprimente-o em uma frase curta, de acordo com o horário, e pergunte em que pode ajudar.)" }] }],
        turnComplete: true,
      },
    });
    manterTelaAcesa();
    return;
  }

  const sc = m.serverContent;
  if (sc) {
    if (sc.interrupted) { pararVoz(); mudarFase("ouvindo"); }

    if (sc.inputTranscription?.text) {
      if (novoTurno) { falaVoce = ""; falaJarvis = ""; novoTurno = false; }
      falaVoce += sc.inputTranscription.text;
      mostrarLegenda();
      if (fase !== "falando") mudarFase("ouvindo");
    }
    if (sc.outputTranscription?.text) {
      falaJarvis += sc.outputTranscription.text;
      mostrarLegenda();
    }
    for (const parte of sc.modelTurn?.parts || []) {
      const d = parte.inlineData;
      if (d?.data && (d.mimeType || "").startsWith("audio/")) {
        const taxa = Number((d.mimeType.match(/rate=(\d+)/) || [])[1]) || 24000;
        tocarAudio(d.data, taxa);
      }
    }
    if (sc.turnComplete) novoTurno = true;
  }

  if (m.goAway) mostrarErro("A sessão está perto do limite de tempo. Se cair, toque para falar de novo.");
}

function alternarMudo() {
  if (!microfone) return;
  mudo = !mudo;
  microfone.getAudioTracks().forEach((t) => { t.enabled = !mudo; });
  el.mudo.textContent = mudo ? "Ligar microfone" : "Silenciar microfone";
  mudarFase(fase);
}

function encerrar() {
  encerrandoDePropósito = true;
  try { ws?.close(); } catch {}
  ws = null;
  pararVoz();
  try { fonteMic?.disconnect(); noMic?.disconnect(); } catch {}
  microfone?.getTracks().forEach((t) => t.stop());
  microfone = null; fonteMic = null; noMic = null; analisadorMic = null;
  mudo = false; el.mudo.textContent = "Silenciar microfone";
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
  mudarFase("parado");
}

async function manterTelaAcesa() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}

// ---------- Senha ----------

function pedirSenha(msg) {
  el.senhaBox.hidden = false;
  el.campoSenha.value = "";
  if (msg) mostrarErro(msg);
  setTimeout(() => el.campoSenha.focus(), 50);
}

el.formSenha.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const s = el.campoSenha.value.trim();
  if (!s) return;
  gravarSenha(s);
  el.senhaBox.hidden = true;
  mostrarErro("");
  iniciar();
});

// ---------- Áudio ----------

async function prepararAudio() {
  await contexto.audioWorklet.addModule("/mic-worklet.js");
  fonteMic = contexto.createMediaStreamSource(microfone);
  noMic = new AudioWorkletNode(contexto, "microfone-jarvis");
  analisadorMic = contexto.createAnalyser();
  analisadorMic.fftSize = 512;
  fonteMic.connect(analisadorMic);
  fonteMic.connect(noMic);
  // O nó precisa chegar ao destino para rodar; o ganho zero evita eco.
  const silencio = contexto.createGain();
  silencio.gain.value = 0;
  noMic.connect(silencio).connect(contexto.destination);

  if (!saidaVoz) {
    saidaVoz = contexto.createGain();
    analisadorVoz = contexto.createAnalyser();
    analisadorVoz.fftSize = 512;
    saidaVoz.connect(analisadorVoz);
    analisadorVoz.connect(contexto.destination);
  }
}

function paraBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function enviarAudio(buffer) {
  enviar({ realtimeInput: { audio: { data: paraBase64(buffer), mimeType: "audio/pcm;rate=16000" } } });
}

function tocarAudio(b64, taxa) {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const buf = contexto.createBuffer(1, n, taxa);
  const canal = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    canal[i] = v / 0x8000;
  }
  const src = contexto.createBufferSource();
  src.buffer = buf;
  src.connect(saidaVoz);
  const inicio = Math.max(contexto.currentTime + 0.03, proximoInicio);
  src.start(inicio);
  proximoInicio = inicio + buf.duration;
  tocando.add(src);
  mudarFase("falando");
  src.onended = () => {
    tocando.delete(src);
    if (!tocando.size && fase === "falando") mudarFase("ouvindo");
  };
}

function pararVoz() {
  for (const s of tocando) { try { s.onended = null; s.stop(); } catch {} }
  tocando.clear();
  proximoInicio = 0;
}

const amostra = new Uint8Array(512);
function nivel(analisador) {
  if (!analisador) return 0;
  analisador.getByteTimeDomainData(amostra);
  let soma = 0;
  for (let i = 0; i < amostra.length; i++) { const v = (amostra[i] - 128) / 128; soma += v * v; }
  return Math.min(1, Math.sqrt(soma / amostra.length) * 4);
}

// ---------- Esfera ----------

const ctx = el.orbe.getContext("2d");
let energia = 0;

function desenhar(t) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const lado = el.orbe.clientWidth;
  if (el.orbe.width !== Math.round(lado * dpr)) { el.orbe.width = el.orbe.height = Math.round(lado * dpr); }
  const W = el.orbe.width, c = W / 2;
  ctx.clearRect(0, 0, W, W);

  let alvo = 0.05;
  if (fase === "ouvindo") alvo = mudo ? 0.03 : 0.12 + nivel(analisadorMic) * 0.9;
  else if (fase === "falando") alvo = 0.25 + nivel(analisadorVoz) * 0.9;
  else if (fase === "pensando" || fase === "conectando") alvo = 0.18 + 0.1 * Math.sin(t / 260);
  energia += (alvo - energia) * 0.18;

  const base = W * 0.2;
  const raio = base * (1 + energia * 0.35);
  const brilho = fase === "parado" ? 0.55 : 1;

  const halo = ctx.createRadialGradient(c, c, raio * 0.4, c, c, W * 0.5);
  halo.addColorStop(0, `rgba(201,245,106,${0.22 * brilho + energia * 0.2})`);
  halo.addColorStop(1, "rgba(201,245,106,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, W);

  for (let i = 0; i < 3; i++) {
    const r = raio * (1.45 + i * 0.32) + energia * W * 0.03 * (i + 1);
    const giro = (t / (2600 + i * 900)) * (i % 2 ? -1 : 1);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(giro);
    ctx.strokeStyle = `rgba(201,245,106,${(0.5 - i * 0.12) * brilho})`;
    ctx.lineWidth = Math.max(1, W * 0.004);
    ctx.setLineDash(i === 1 ? [W * 0.004, W * 0.018] : [W * 0.09, W * 0.04]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.beginPath();
  const pontos = 96;
  for (let k = 0; k <= pontos; k++) {
    const a = (k / pontos) * Math.PI * 2;
    const onda = Math.sin(a * 6 + t / 220) * energia * raio * 0.08 + Math.sin(a * 11 - t / 170) * energia * raio * 0.05;
    const x = c + Math.cos(a) * (raio + onda), y = c + Math.sin(a) * (raio + onda);
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  const nucleo = ctx.createRadialGradient(c, c - raio * 0.3, raio * 0.1, c, c, raio);
  nucleo.addColorStop(0, `rgba(225,255,170,${0.95 * brilho})`);
  nucleo.addColorStop(0.55, `rgba(201,245,106,${0.75 * brilho})`);
  nucleo.addColorStop(1, `rgba(90,140,30,${0.6 * brilho})`);
  ctx.fillStyle = nucleo;
  ctx.shadowColor = "rgba(201,245,106,.8)";
  ctx.shadowBlur = W * 0.06 * (0.6 + energia);
  ctx.fill();
  ctx.shadowBlur = 0;

  requestAnimationFrame(desenhar);
}
requestAnimationFrame(desenhar);

// ---------- Botões ----------

el.iniciar.addEventListener("click", iniciar);
el.orbe.addEventListener("click", () => { if (fase === "parado") iniciar(); });
el.orbe.addEventListener("keydown", (ev) => { if ((ev.key === "Enter" || ev.key === " ") && fase === "parado") { ev.preventDefault(); iniciar(); } });
el.mudo.addEventListener("click", alternarMudo);
el.encerrar.addEventListener("click", encerrar);
document.addEventListener("visibilitychange", () => { if (document.hidden && fase !== "parado") encerrar(); });
