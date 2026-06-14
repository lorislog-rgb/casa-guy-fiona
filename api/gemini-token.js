const MODEL = "models/gemini-2.0-flash-live-001";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY non configurata su Vercel" });
    return;
  }

  try {
    const now = Date.now();
    const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(now + 2 * 60 * 1000).toISOString();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("Gemini token error:", response.status, err);
      res.status(502).json({
        error: `Google error ${response.status}: ${err.slice(0, 200)}`,
      });
      return;
    }

    const data = await response.json();
    res.status(200).json({ token: data.name, model: MODEL });
  } catch (err) {
    console.error("gemini-token error:", err);
    res.status(500).json({ error: "Errore creazione token: " + err.message });
  }
}
