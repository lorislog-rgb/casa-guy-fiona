import { useState, useRef, useCallback } from "react";

const STATUS_LABEL = {
  ready: "Pronto",
  connecting: "Connessione…",
  active: "Chat vocale in corso",
  ended: "Chat vocale terminata",
  error: "Errore",
};

export default function App() {
  const [status, setStatus] = useState("ready");
  const [errorMsg, setErrorMsg] = useState("");
  const [fionaText, setFionaText] = useState("");
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);

  const cleanup = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
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
    setFionaText("");

    try {
      // 1. Get ephemeral token from backend
      const res = await fetch("/api/realtime-session", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Errore server ${res.status}`);
      }
      const { clientSecret } = await res.json();
      if (!clientSecret) throw new Error("Token non ricevuto. Controlla OPENAI_API_KEY su Vercel.");

      // 2. Setup WebRTC peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      pc.addTrack(stream.getTracks()[0]);

      // 4. Setup remote audio (Fiona's voice)
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      // 5. Create data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        setStatus("active");

        // Trigger Fiona's greeting
        dc.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio", "text"],
              instructions:
                "Saluta il chiamante con il tuo saluto di benvenuto a Casa Gay. Parla in italiano.",
            },
          }),
        );
      };

      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          if (msg.type === "response.audio_transcript.done") {
            setFionaText(msg.transcript || "");
          }

          if (msg.type === "error") {
            const errMsg =
              msg.error?.message || JSON.stringify(msg.error) || "Errore";
            console.error("Realtime error:", errMsg);
            if (msg.error?.code === "session_expired") {
              endCall();
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      dc.onclose = () => {
        if (pcRef.current) endCall();
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "disconnected"
        ) {
          endCall();
        }
      };

      // 6. Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Send offer to OpenAI and get answer
      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        },
      );

      if (!sdpRes.ok) {
        const errText = await sdpRes.text();
        throw new Error(`Connessione OpenAI fallita: ${sdpRes.status} ${errText.slice(0, 100)}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
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

      {status === "active" && fionaText && (
        <div className="bg-purple-900/30 border border-purple-500/30 rounded-lg p-3 mb-4 max-w-md w-full">
          <p className="text-purple-200 text-sm">
            <span className="font-semibold">Fiona:</span> {fionaText}
          </p>
        </div>
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
