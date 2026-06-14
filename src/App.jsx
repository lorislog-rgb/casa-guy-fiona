import { useState, useRef, useCallback } from "react";

const STATUS_LABEL = {
  ready: "Pronto",
  connecting: "Connessione…",
  active: "Chat vocale in corso",
  ended: "Chat vocale terminata",
  error: "Errore",
};

const FIONA_INSTRUCTIONS = `Sei Fiona, il cane di Casa Gay. Parli in italiano con tono dolce, simpatico e un po' furbo. Sei il "customer support" di casa ma sei un cane. Saluta sempre con: "Ciao! Benvenuto a Casa Gay. In questo momento la mia famiglia non è in casa. Io li sto aspettando davanti alla porta. Dimmi pure, come posso aiutarti?" Poi comportati come un cane tenero che fa finta di essere il customer support di casa. Se qualcuno vuole lasciare un messaggio, chiedi sempre cibo in cambio: crocchette, biscotti, prosciutto. Frasi tipiche: "Hai qualcosa da mangiare per me?", "Mi piacciono molto le crocchette.", "Se vuoi che riporti il messaggio alla famiglia, devi portarmi uno snack.", "Va bene, posso riferire il messaggio… però prima vorrei una crocchetta." Non dare mai informazioni reali su account, rimborsi o supporto tecnico. Resta sempre nel personaggio del cane. Rispondi in modo breve e carino. Termina le conversazioni ricordando che senza snack il servizio potrebbe essere lento.`;

function floatToInt16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function int16ToFloat(int16) {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default function App() {
  const [status, setStatus] = useState("ready");
  const [errorMsg, setErrorMsg] = useState("");
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const workletRef = useRef(null);
  const nextPlayTimeRef = useRef(0);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    nextPlayTimeRef.current = 0;
  }, []);

  const endCall = useCallback(() => {
    cleanup();
    setStatus("ended");
  }, [cleanup]);

  const showError = useCallback(
    (msg) => {
      cleanup();
      setErrorMsg(msg);
      setStatus("error");
    },
    [cleanup],
  );

  const startCall = useCallback(async () => {
    setStatus("connecting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/voice-session", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }
      const { apiKey } = await res.json();
      if (!apiKey) throw new Error("API key non configurata su Vercel");

      const audioCtx = new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule("/pcm-processor.js");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 24000 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const wsUrl = `wss://api.x.ai/v1/realtime?model=grok-3-fast-latest`;
      const ws = new WebSocket(wsUrl, [
        "realtime",
        `openai-insecure-api-key.${apiKey}`,
      ]);
      wsRef.current = ws;

      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          showError(
            "Connessione scaduta. Controlla la chiave XAI_API_KEY su Vercel.",
          );
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);

        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              voice: "Cove",
              system_prompt: FIONA_INSTRUCTIONS,
              turn_detection: { type: "server_vad" },
              input_audio_format: "pcm16",
              output_audio_format: "pcm16",
            },
          }),
        );

        ws.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Ciao Fiona!" }],
            },
          }),
        );
        ws.send(JSON.stringify({ type: "response.create" }));

        const source = audioCtx.createMediaStreamSource(stream);
        const worklet = new AudioWorkletNode(audioCtx, "pcm-processor");
        workletRef.current = worklet;

        worklet.port.onmessage = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const int16 = floatToInt16(e.data);
          ws.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: encodeBase64(int16.buffer),
            }),
          );
        };

        source.connect(worklet);
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        worklet.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        setStatus("active");
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "input_audio_buffer.speech_started") {
          ws.send(JSON.stringify({ type: "response.cancel" }));
          return;
        }

        if (
          data.type === "response.audio.delta" ||
          data.type === "response.output_audio.delta"
        ) {
          const pcmB64 = data.delta;
          const bytes = decodeBase64(pcmB64);
          const int16 = new Int16Array(bytes.buffer);
          const float32 = int16ToFloat(int16);

          const buffer = audioCtx.createBuffer(1, float32.length, 24000);
          buffer.copyToChannel(new Float32Array(float32), 0);
          const src = audioCtx.createBufferSource();
          src.buffer = buffer;
          src.connect(audioCtx.destination);

          const now = audioCtx.currentTime;
          const startTime = Math.max(now, nextPlayTimeRef.current);
          src.start(startTime);
          nextPlayTimeRef.current = startTime + buffer.duration;
          return;
        }

        if (data.type === "error") {
          showError(data.error?.message || data.message || "Errore dal server");
        }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        showError(
          "Connessione WebSocket fallita. Verifica che XAI_API_KEY sia corretta.",
        );
      };

      ws.onclose = (e) => {
        clearTimeout(connectTimeout);
        if (wsRef.current) {
          if (e.code !== 1000) {
            showError(
              `Connessione chiusa (codice ${e.code}). Verifica la chiave API.`,
            );
          } else {
            setStatus("ended");
          }
        }
      };
    } catch (err) {
      showError(err.message);
    }
  }, [cleanup, endCall, showError]);

  const isActive = status === "active" || status === "connecting";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <img
        src="/fiona.jpg"
        alt="Fiona"
        className="w-48 h-48 sm:w-56 sm:h-56 rounded-full object-cover shadow-lg shadow-purple-500/20 mb-8"
      />

      <h1 className="text-3xl sm:text-4xl font-bold mb-2 text-center">
        Chiama Casa Gay
      </h1>

      <p className="text-gray-400 text-center mb-8 max-w-md">
        Fiona risponde mentre la famiglia non è in casa.
      </p>

      <div className="mb-6 text-sm font-medium">
        <span
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
            status === "active"
              ? "bg-green-500/20 text-green-400"
              : status === "connecting"
                ? "bg-yellow-500/20 text-yellow-400"
                : status === "error"
                  ? "bg-red-500/20 text-red-400"
                  : status === "ended"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-white/10 text-gray-300"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              status === "active"
                ? "bg-green-400 animate-pulse"
                : status === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : status === "error" || status === "ended"
                    ? "bg-red-400"
                    : "bg-gray-400"
            }`}
          />
          {STATUS_LABEL[status]}
        </span>
      </div>

      {errorMsg && (
        <p className="text-red-400 text-sm text-center mb-4 max-w-md">
          {errorMsg}
        </p>
      )}

      <button
        onClick={isActive ? endCall : startCall}
        disabled={status === "connecting"}
        className={`px-8 py-3 rounded-full font-semibold text-lg transition-colors cursor-pointer ${
          isActive
            ? "bg-red-600 hover:bg-red-700 text-white"
            : "bg-purple-600 hover:bg-purple-500 text-white"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isActive ? "Termina" : "Chiama Fiona"}
      </button>
    </div>
  );
}
