import { useState, useRef, useCallback, useEffect } from "react";

const STATUS_LABEL = {
  ready: "Pronto",
  connecting: "Connessione…",
  active: "Chat vocale in corso",
  ended: "Chat vocale terminata",
  error: "Errore",
};

const SpeechRecognition =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

function speak(text, voice, onEnd) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "it-IT";
  utterance.rate = 1.05;
  utterance.pitch = 1.15;
  if (voice) utterance.voice = voice;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export default function App() {
  const [status, setStatus] = useState("ready");
  const [errorMsg, setErrorMsg] = useState("");
  const [transcript, setTranscript] = useState("");
  const [fionaText, setFionaText] = useState("");
  const [listening, setListening] = useState(false);
  const messagesRef = useRef([]);
  const recognitionRef = useRef(null);
  const activeRef = useRef(false);
  const voiceRef = useRef(null);

  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const italian =
        voices.find((v) => v.lang === "it-IT" && v.name.includes("Google")) ||
        voices.find((v) => v.lang === "it-IT") ||
        voices.find((v) => v.lang.startsWith("it"));
      if (italian) voiceRef.current = italian;
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const cleanup = useCallback(() => {
    activeRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    window.speechSynthesis.cancel();
    setListening(false);
  }, []);

  const showError = useCallback(
    (msg) => {
      cleanup();
      setErrorMsg(msg);
      setStatus("error");
    },
    [cleanup],
  );

  const endCall = useCallback(() => {
    cleanup();
    setStatus("ended");
  }, [cleanup]);

  const startListening = useCallback(() => {
    if (!activeRef.current || !SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "it-IT";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);

    recognition.onresult = async (event) => {
      setListening(false);
      const userText = event.results[0][0].transcript;
      setTranscript(userText);

      messagesRef.current.push({ role: "user", content: userText });

      try {
        const res = await fetch("/api/voice-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: messagesRef.current }),
        });

        if (!res.ok) throw new Error(`Errore server: ${res.status}`);
        const data = await res.json();
        const reply = data.reply || "Bau!";

        messagesRef.current.push({ role: "assistant", content: reply });
        setFionaText(reply);

        speak(reply, voiceRef.current, () => {
          if (activeRef.current) startListening();
        });
      } catch (err) {
        showError("Errore nella risposta: " + err.message);
      }
    };

    recognition.onerror = (e) => {
      setListening(false);
      if (e.error === "no-speech" && activeRef.current) {
        startListening();
        return;
      }
      if (e.error === "aborted") return;
      console.error("Speech recognition error:", e.error);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.start();
  }, [showError]);

  const startCall = useCallback(async () => {
    if (!SpeechRecognition) {
      showError(
        "Il tuo browser non supporta il riconoscimento vocale. Usa Chrome.",
      );
      return;
    }

    setStatus("connecting");
    setErrorMsg("");
    setTranscript("");
    setFionaText("");
    messagesRef.current = [];

    try {
      const res = await fetch("/api/voice-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ||
            `Errore server ${res.status}. Hai configurato XAI_API_KEY su Vercel?`,
        );
      }

      const data = await res.json();
      const greeting = data.reply;

      messagesRef.current.push({ role: "assistant", content: greeting });
      setFionaText(greeting);

      activeRef.current = true;
      setStatus("active");

      speak(greeting, voiceRef.current, () => {
        if (activeRef.current) startListening();
      });
    } catch (err) {
      showError(err.message);
    }
  }, [showError, startListening]);

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

      {status === "active" && (
        <div className="mb-6 max-w-md w-full space-y-3">
          {fionaText && (
            <div className="bg-purple-900/30 border border-purple-500/30 rounded-lg p-3">
              <p className="text-purple-200 text-sm">
                <span className="font-semibold">Fiona:</span> {fionaText}
              </p>
            </div>
          )}
          {transcript && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
              <p className="text-gray-300 text-sm">
                <span className="font-semibold">Tu:</span> {transcript}
              </p>
            </div>
          )}
          {listening && (
            <p className="text-yellow-400 text-xs text-center animate-pulse">
              Ti ascolto...
            </p>
          )}
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
