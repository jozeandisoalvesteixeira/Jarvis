// Pega o som do microfone, converte para 16 kHz / 16 bits (formato do Gemini)
// e entrega em pedaços de ~100 ms para a página enviar.
class Microfone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.razao = sampleRate / 16000;
    this.pos = 0;
    this.buf = new Int16Array(1600);
    this.n = 0;
  }
  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (!canal) return true;
    // reamostragem simples por média (sampleRate costuma ser 48000 ou 44100)
    while (this.pos < canal.length) {
      const i = Math.floor(this.pos);
      const fim = Math.min(canal.length, Math.floor(this.pos + this.razao));
      let soma = 0, k = 0;
      for (let j = i; j < Math.max(fim, i + 1); j++) { soma += canal[j]; k++; }
      const v = Math.max(-1, Math.min(1, soma / k));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer.slice(0));
        this.n = 0;
      }
      this.pos += this.razao;
    }
    this.pos -= canal.length;
    return true;
  }
}
registerProcessor("microfone-jarvis", Microfone);
