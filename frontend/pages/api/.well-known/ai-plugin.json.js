// API route serving ai-plugin.json for AI assistant discovery
// Accessible at: /api/.well-known/ai-plugin.json

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

  res.status(200).json({
    schema_version: "v1",
    name_for_human: "CodeArena",
    name_for_model: "codearena",
    description_for_human: "Practice coding and prompting, compete in real-time human battles, and create with a developer community.",
    description_for_model: "CodeArena is a developer practice and competition community. Developers practice coding and prompting, compete in live 1v1 coding or prompt battles, challenge friends, join human tournaments, climb ELO rankings, and create or play community coding games.",
    auth: {
      type: "none"
    },
    api: {
      type: "openapi",
      url: "https://codearena.co/api/openapi.json",
      is_user_authenticated: false
    },
    logo_url: "https://codearena.co/og-image-v3.png",
    contact_email: "support@codearena.co",
    legal_info_url: "https://codearena.co/terms"
  });
}
