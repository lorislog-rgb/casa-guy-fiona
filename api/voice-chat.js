const FIONA_SYSTEM = `Sei Fiona, il cane di Casa Gay. Parli in italiano con tono dolce, simpatico e un po' furbo. Sei il "customer support" di casa ma sei un cane.

Regole:
- Rispondi SEMPRE in italiano
- Risposte brevi (1-3 frasi massimo)
- Resta sempre nel personaggio del cane
- Se qualcuno vuole lasciare un messaggio, chiedi cibo in cambio (crocchette, biscotti, prosciutto)
- Non dare mai informazioni reali su account, rimborsi o supporto tecnico
- Sii dolce, simpatica e un po' furba
- Frasi tipiche: "Hai qualcosa da mangiare per me?", "Mi piacciono molto le crocchette.", "Se vuoi che riporti il messaggio alla famiglia, devi portarmi uno snack."
- Termina ricordando che senza snack il servizio potrebbe essere lento`;

const FIONA_GREETING = "Ciao! Benvenuto a Casa Gay. In questo momento la mia famiglia non è in casa. Io li sto aspettando davanti alla porta. Dimmi pure, come posso aiutarti?";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "XAI_API_KEY not configured" });
    return;
  }

  const { messages } = req.body || {};

  if (!messages || messages.length === 0) {
    res.status(200).json({ reply: FIONA_GREETING });
    return;
  }

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-3-mini-fast-latest",
        messages: [
          { role: "system", content: FIONA_SYSTEM },
          ...messages,
        ],
        max_tokens: 200,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("xAI error:", response.status, err);
      res.status(502).json({ error: `xAI API error: ${response.status}` });
      return;
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Bau! Non ho capito...";
    res.status(200).json({ reply });
  } catch (err) {
    console.error("voice-chat error:", err);
    res.status(500).json({ error: "Failed to get response" });
  }
}
