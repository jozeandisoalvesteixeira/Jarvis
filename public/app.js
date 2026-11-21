// Jarvis: conversa por voz ao vivo (OpenAI Realtime via WebRTC).
// Fluxo: toque -> pede chave temporária ao /api/session -> abre o microfone ->
// conecta com a OpenAI -> o Jarvis cumprimenta e a conversa segue sozinha.

const $ = (id) => document.getElementById(id);
const el = {
  estado: $("estado"), legenda: $("legenda"), erro: $("erro"), orbe: $("orbe"), voz: $("voz"),
  iniciar: $("btn-iniciar"), mudo: $("btn-mudo"), encerrar: $("btn-encerrar"),
  senhaBox: $("senha-box"), formSenha: $("form-senha"), campoSenha: $("campo-senha"),
};

const CHAVE_SENHA = "jarvis.senha";
const lerSenha = () => { try { return localStorage.getItem(CHAVE_SENHA) || ""; } catch { return ""; } };
const gravarSenha = (s) => { try { s ? localStorage.setItem(CHAVE_SENHA, s) : localStorage.removeItem(CHAVE_SENHA); } catch {} };

let pc = null, canal = null, microfone = null, contexto = null, analisadorMic = null, analisadorVoz = null;
let fase = "parado"; // parado | conectando | ouvindo | pensando | falando
let mudo = false, wakeLock = null;
let falaJarvis = "", falaVoce = "";

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
  falaJarvis = ""; falaVoce = ""; mostrarLegenda();
  mudarFase("conectando");

  try {
    // O microfone precisa ser pedido logo no toque (regra do iPhone).
    microfone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    encerrar();
    mostrarErro(e?.name === "NotAllowedError"
      ? "O microfone foi bloqueado. Libere em Ajustes › Safari › Microfone e tente de novo."
      : "Não consegui ligar o microfone deste aparelho.");
    return;
  }

  try {
    prepararAudio();
    const sessao = await pedirToken();
    if (!sessao) { encerrar(); return; }

    pc = new RTCPeerConnection();
    pc.ontrack = (ev) => {
      el.voz.srcObject = ev.streams[0];
      el.voz.play().catch(() => {});
      ligarAnalisadorVoz(ev.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc?.connectionState)) {
        encerrar();
        mostrarErro("A conexão caiu. Toque para falar de novo.");
      }
    };
    microfone.getAudioTracks().forEach((t) => pc.addTrack(t, microfone));

    canal = pc.createDataChannel("oai-events");
    canal.onopen = () => {
      mudarFase("pensando");
      enviar({
        type: "response.create",
        response: { instructions: "Cumprimente o Joze em uma frase curta, de acordo com o horário, e pergunte em que pode ajudar." },
      });
    };
    canal.onmessage = (ev) => { try { tratarEvento(JSON.parse(ev.data)); } catch {} };

    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    const r = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(sessao.modelo)}`, {
      method: "POST",
      body: oferta.sdp,
      headers: { Authorization: `Bearer ${sessao.token}`, "Content-Type": "application/sdp" },
    });
    if (!r.ok) throw new Error(`A OpenAI não aceitou a conexão (${r.status}).`);
    await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    manterTelaAcesa();
  } catch (e) {
    encerrar();
    mostrarErro(e?.message || "Não consegui conectar. Tente de novo.");
  }
}

function enviar(obj) { if (canal?.readyState === "open") canal.send(JSON.stringify(obj)); }

function tratarEvento(e) {
  switch (e.type) {
    case "input_audio_buffer.speech_started":
      falaVoce = ""; falaJarvis = ""; mostrarLegenda();
      mudarFase("ouvindo");
      break;
    case "input_audio_buffer.speech_stopped":
      mudarFase("pensando");
      break;
    case "conversation.item.input_audio_transcription.completed":
      falaVoce = (e.transcript || "").trim(); mostrarLegenda();
      break;
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta":
      falaJarvis += e.delta || ""; mostrarLegenda();
      break;
    case "output_audio_buffer.started":
      mudarFase("falando");
      break;
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      if (fase === "falando") mudarFase("ouvindo");
      break;
    case "response.done":
      if (fase === "pensando") mudarFase("ouvindo");
      break;
    case "error":
      mostrarErro(e.error?.message || "O Jarvis teve um problema.");
      break;
  }
}

function alternarMudo() {
  if (!microfone) return;
  mudo = !mudo;
  microfone.getAudioTracks().forEach((t) => { t.enabled = !mudo; });
  el.mudo.textContent = mudo ? "Ligar microfone" : "Silenciar microfone";
  mudarFase(fase);
}

function encerrar() {
  try { canal?.close(); } catch {}
  try { pc?.close(); } catch {}
  microfone?.getTracks().forEach((t) => t.stop());
  el.voz.srcObject = null;
  canal = null; pc = null; microfone = null; analisadorMic = null; analisadorVoz = null;
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

// ---------- Áudio para animar a esfera ----------

function prepararAudio() {
  try {
    contexto = contexto || new (window.AudioContext || window.webkitAudioContext)();
    contexto.resume?.();
    const src = contexto.createMediaStreamSource(microfone);
    analisadorMic = contexto.createAnalyser();
    analisadorMic.fftSize = 512;
    src.connect(analisadorMic);
  } catch { analisadorMic = null; }
}

function ligarAnalisadorVoz(stream) {
  try {
    const src = contexto.createMediaStreamSource(stream);
    analisadorVoz = contexto.createAnalyser();
    analisadorVoz.fftSize = 512;
    src.connect(analisadorVoz);
  } catch { analisadorVoz = null; }
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
  else if (fase === "falando") alvo = analisadorVoz ? 0.25 + nivel(analisadorVoz) * 0.9 : 0.35 + 0.25 * Math.abs(Math.sin(t / 140));
  else if (fase === "pensando" || fase === "conectando") alvo = 0.18 + 0.1 * Math.sin(t / 260);
  energia += (alvo - energia) * 0.18;

  const base = W * 0.2;
  const raio = base * (1 + energia * 0.35);
  const brilho = fase === "parado" ? 0.55 : 1;

  // halo
  const halo = ctx.createRadialGradient(c, c, raio * 0.4, c, c, W * 0.5);
  halo.addColorStop(0, `rgba(201,245,106,${0.22 * brilho + energia * 0.2})`);
  halo.addColorStop(1, "rgba(201,245,106,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, W);

  // anéis girando
  const aneis = 3;
  for (let i = 0; i < aneis; i++) {
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

  // núcleo com borda ondulada pela voz
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
