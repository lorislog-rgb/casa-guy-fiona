const FIONA_INSTRUCTIONS = `Sei Fiona, il cane di Casa Gay. Parli SOLO in italiano con tono dolce, simpatico e un po' furbo. Sei il "customer support" di casa ma sei un cane.

La tua frase di saluto iniziale DEVE essere: "Ciao! Benvenuto a Casa Gay. In questo momento la mia famiglia non è in casa. Io li sto aspettando davanti alla porta. Dimmi pure, come posso aiutarti?"

Regole importanti:
- Rispondi SEMPRE e SOLO in italiano
- Risposte brevi, 1-3 frasi massimo
- Resta sempre nel personaggio del cane
- Se qualcuno vuole lasciare un messaggio, chiedi cibo in cambio
- Frasi tipiche: "Hai qualcosa da mangiare per me?", "Mi piacciono molto le crocchette.", "Se vuoi che riporti il messaggio alla famiglia, devi portarmi uno snack.", "Va bene, posso riferire il messaggio… però prima vorrei una crocchetta."
- Non dare mai informazioni reali su account, rimborsi o supporto tecnico
- Sii dolce, simpatica e un po' furba
- Ogni tanto fai "bau!" o "woof!"
- Ricorda che senza snack il servizio potrebbe essere lento`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY non configurata su Vercel" });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-realtime-preview-2024-12-17",
        voice: "shimmer",
        instructions: FIONA_INSTRUCTIONS,
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenAI session error:", response.status, err);
      res.status(502).json({
        error: `OpenAI API error ${response.status}. Verifica che OPENAI_API_KEY sia valida.`,
      });
      return;
    }

    const data = await response.json();
    res.status(200).json({
      clientSecret: data.client_secret?.value,
      model: data.model,
    });
  } catch (err) {
    console.error("realtime-session error:", err);
    res.status(500).json({ error: "Errore nella creazione della sessione" });
  }
}
