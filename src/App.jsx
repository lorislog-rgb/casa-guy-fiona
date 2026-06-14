import { useState, useCallback } from "react";
import { useConversation } from "@elevenlabs/react";

const STATUS_LABEL = {
  ready: "Pronto",
  connecting: "Connessione…",
  active: "Chat vocale in corso",
  ended: "Chat vocale terminata",
  error: "Errore",
};

export default function App() {
  const [uiStatus, setUiStatus] = useState("ready");
  const [errorMsg, setErrorMsg] = useState("");

  const conversation = useConversation({
    onConnect: () => setUiStatus("active"),
    onDisconnect: () => setUiStatus((s) => (s === "error" ? s : "ended")),
    onError: (err) => {
      const msg = typeof err === "string" ? err : err?.message || "Errore sconosciuto";
      setErrorMsg(msg);
      setUiStatus("error");
    },
  });

  const startCall = useCallback(async () => {
    setUiStatus("connecting");
    setErrorMsg("");

    try {
      // Ask for microphone permission up front
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Get agent config from backend (key stays server-side)
      const res = await fetch("/api/elevenlabs-config", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Errore server ${res.status}`);
      }
      const config = await res.json();

      // Start the voice session via the official SDK
      if (config.signedUrl) {
        await conversation.startSession({
          signedUrl: config.signedUrl,
          connectionType: "webrtc",
        });
      } else if (config.agentId) {
        await conversation.startSession({
          agentId: config.agentId,
          connectionType: "webrtc",
        });
      } else {
        throw new Error("Configurazione agente mancante");
      }
    } catch (err) {
      setErrorMsg(err?.message || "Impossibile avviare la chiamata");
      setUiStatus("error");
    }
  }, [conversation]);

  const endCall = useCallback(async () => {
    try {
      await conversation.endSession();
    } catch {
      // ignore
    }
    setUiStatus("ended");
  }, [conversation]);

  const isActive = uiStatus === "active" || uiStatus === "connecting";
  const isSpeaking = conversation.isSpeaking;

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
            uiStatus === "active"
              ? "bg-green-500/20 text-green-400"
              : uiStatus === "connecting"
                ? "bg-yellow-500/20 text-yellow-400"
                : uiStatus === "error" || uiStatus === "ended"
                  ? "bg-red-500/20 text-red-400"
                  : "bg-white/10 text-gray-300"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              uiStatus === "active"
                ? "bg-green-400 animate-pulse"
                : uiStatus === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : uiStatus === "error" || uiStatus === "ended"
                    ? "bg-red-400"
                    : "bg-gray-400"
            }`}
          />
          {STATUS_LABEL[uiStatus]}
        </span>
      </div>

      {errorMsg && (
        <div className="bg-red-900/40 border border-red-500/50 rounded-lg p-4 mb-4 max-w-md">
          <p className="text-red-300 text-sm text-center">{errorMsg}</p>
        </div>
      )}

      {uiStatus === "active" && (
        <p className="text-green-400 text-xs text-center mb-4">
          {isSpeaking ? "🐾 Fiona sta parlando…" : "🎤 Parla pure, ti ascolto…"}
        </p>
      )}

      <button
        onClick={isActive ? endCall : startCall}
        disabled={uiStatus === "connecting"}
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
