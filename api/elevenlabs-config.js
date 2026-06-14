export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!agentId) {
    res.status(500).json({
      error: "ELEVENLABS_AGENT_ID non configurato su Vercel",
    });
    return;
  }

  // Public agent: just return the agent ID (no key needed).
  if (!apiKey) {
    res.status(200).json({ agentId });
    return;
  }

  // Private agent: mint a signed URL server-side so the key stays hidden.
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        method: "GET",
        headers: { "xi-api-key": apiKey },
      },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("ElevenLabs signed-url error:", response.status, err);
      res.status(502).json({
        error: `ElevenLabs error ${response.status}: ${err.slice(0, 200)}`,
      });
      return;
    }

    const data = await response.json();
    res.status(200).json({ signedUrl: data.signed_url });
  } catch (err) {
    console.error("elevenlabs-config error:", err);
    res.status(500).json({ error: "Errore nella connessione a ElevenLabs" });
  }
}
