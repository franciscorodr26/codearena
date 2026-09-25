// API route serving security.txt
// Accessible at: /api/.well-known/security.txt

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  const securityTxt = `# CodeArena Security Policy
# https://codearena.co/.well-known/security.txt

Contact: mailto:security@codearena.co
Contact: mailto:support@codearena.co
Expires: 2026-12-31T23:59:59.000Z
Preferred-Languages: en
Canonical: https://codearena.co/.well-known/security.txt

# About CodeArena
# Real-time 1v1 competitive coding battle platform
# The multiplayer alternative to LeetCode
# https://codearena.co
`;

  res.status(200).send(securityTxt);
}
