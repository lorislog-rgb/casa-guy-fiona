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

  const { sdp } = req.body || {};
  if (!sdp) {
    res.status(400).json({ error: "SDP offer mancante" });
    return;
  }

  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/calls?model=gpt-realtime",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/sdp",
        },
        body: sdp,
      },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenAI SDP error:", response.status, err);
      res.status(502).json({
        error: `OpenAI error ${response.status}: ${err.slice(0, 200)}`,
      });
      return;
    }

    const answerSdp = await response.text();
    res.status(200).json({ sdp: answerSdp });
  } catch (err) {
    console.error("realtime-session error:", err);
    res.status(500).json({ error: "Errore nella connessione a OpenAI" });
  }
}
