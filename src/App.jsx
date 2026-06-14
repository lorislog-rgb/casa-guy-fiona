import { useState, useRef, useCallback } from "react";

const STATUS_LABEL = {
  ready: "Pronto",
  connecting: "Connessione…",
  active: "Chat vocale in corso",
  ended: "Chat vocale terminata",
  error: "Errore",
};

const FIONA_INSTRUCTIONS = `Sei Fiona, il cane di Casa Gay. Parli SOLO in italiano con tono dolce, simpatico e un po' furbo. Sei il "customer support" di casa ma sei un cane.

Quando saluti per la prima volta dì esattamente: "Ciao! Benvenuto a Casa Gay. In questo momento la mia famiglia non è in casa. Io li sto aspettando davanti alla porta. Dimmi pure, come posso aiutarti?"

Regole:
- Rispondi SEMPRE e SOLO in italiano
- Risposte brevi, 1-3 frasi massimo
- Resta sempre nel personaggio del cane
- Se qualcuno vuole lasciare un messaggio, chiedi cibo in cambio (crocchette, biscotti, prosciutto)
- Frasi tipiche: "Hai qualcosa da mangiare per me?", "Mi piacciono molto le crocchette.", "Se vuoi che riporti il messaggio alla famiglia, devi portarmi uno snack."
- Non dare mai informazioni reali su account, rimborsi o supporto tecnico
- Sii dolce, simpatica e un po' furba
- Ogni tanto fai "bau!" o "woof!"`;

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
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
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
  const [listening, setListening] = useState(false);
  const wsRef = useRef(null);
  const inputCtxRef = useRef(null);
  const outputCtxRef = useRef(null);
  const streamRef = useRef(null);
  const workletRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef([]);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    activeSourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        // ignore
      }
    });
    activeSourcesRef.current = [];
    inputCtxRef.current?.close();
    inputCtxRef.current = null;
    outputCtxRef.current?.close();
    outputCtxRef.current = null;
    nextPlayTimeRef.current = 0;
    setListening(false);
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

  const stopPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        // ignore
      }
    });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const playAudio = useCallback((base64) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    const bytes = decodeBase64(base64);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = int16ToFloat(int16);

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(new Float32Array(float32), 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    src.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;

    activeSourcesRef.current.push(src);
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(
        (s) => s !== src,
      );
    };
  }, []);

  const handleMessage = useCallback(
    async (raw) => {
      let text;
      if (raw instanceof Blob) text = await raw.text();
      else if (raw instanceof ArrayBuffer)
        text = new TextDecoder().decode(raw);
      else text = raw;

      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      if (msg.setupComplete) {
        // Trigger Fiona's greeting
        wsRef.current?.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: "Presentati con il tuo saluto di benvenuto." }],
                },
              ],
              turnComplete: true,
            },
          }),
        );
        return;
      }

      const sc = msg.serverContent;
      if (sc) {
        if (sc.interrupted) {
          stopPlayback();
        }
        const parts = sc.modelTurn?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            playAudio(part.inlineData.data);
          }
        }
      }

      if (msg.error) {
        showError(
          "Gemini: " + (msg.error.message || JSON.stringify(msg.error)),
        );
      }
    },
    [playAudio, stopPlayback, showError],
  );

  const startCall = useCallback(async () => {
    setStatus("connecting");
    setErrorMsg("");

    try {
      // 1. Get ephemeral token from backend
      const res = await fetch("/api/gemini-token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Errore server ${res.status}`);
      }
      const { token, model } = await res.json();
      if (!token) throw new Error("Token non ricevuto. Controlla GEMINI_API_KEY su Vercel.");

      // 2. Setup audio contexts
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;
      await inputCtx.audioWorklet.addModule("/pcm-processor.js");

      const outputCtx = new AudioContext({ sampleRate: 24000 });
      outputCtxRef.current = outputCtx;

      // 3. Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // 4. Connect to Gemini Live WebSocket with ephemeral token
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          showError("Connessione scaduta. Riprova.");
        }
      }, 12000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);

        // Send setup
        ws.send(
          JSON.stringify({
            setup: {
              model,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Aoede" },
                  },
                  languageCode: "it-IT",
                },
              },
              systemInstruction: {
                parts: [{ text: FIONA_INSTRUCTIONS }],
              },
            },
          }),
        );

        // Start streaming mic audio
        const source = inputCtx.createMediaStreamSource(stream);
        const worklet = new AudioWorkletNode(inputCtx, "pcm-processor");
        workletRef.current = worklet;

        worklet.port.onmessage = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const int16 = floatToInt16(e.data);
          const b64 = encodeBase64(int16.buffer);
          ws.send(
            JSON.stringify({
              realtimeInput: {
                mediaChunks: [
                  { mimeType: "audio/pcm;rate=16000", data: b64 },
                ],
              },
            }),
          );
        };

        source.connect(worklet);
        const silentGain = inputCtx.createGain();
        silentGain.gain.value = 0;
        worklet.connect(silentGain);
        silentGain.connect(inputCtx.destination);

        setListening(true);
        setStatus("active");
      };

      ws.onmessage = (event) => handleMessage(event.data);

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        showError("Errore di connessione a Gemini. Verifica GEMINI_API_KEY.");
      };

      ws.onclose = (e) => {
        clearTimeout(connectTimeout);
        if (wsRef.current) {
          if (e.code !== 1000 && e.code !== 1005) {
            showError(
              `Codice ${e.code}: ${e.reason || ""} — Token ricevuto: "${token}"`,
            );
          } else {
            setStatus("ended");
          }
        }
      };
    } catch (err) {
      showError(err.message);
    }
  }, [handleMessage, showError]);

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

      <div className="mb-4 text-sm font-medium">
        <span
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
            status === "active"
              ? "bg-green-500/20 text-green-400"
              : status === "connecting"
                ? "bg-yellow-500/20 text-yellow-400"
                : status === "error" || status === "ended"
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
        <div className="bg-red-900/40 border border-red-500/50 rounded-lg p-4 mb-4 max-w-md">
          <p className="text-red-300 text-sm text-center">{errorMsg}</p>
        </div>
      )}

      {status === "active" && listening && (
        <p className="text-green-400 text-xs text-center mb-4 animate-pulse">
          🎤 Parla pure, Fiona ti ascolta…
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
