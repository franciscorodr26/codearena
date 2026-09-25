// API route serving OpenAPI spec for AI assistant discovery
// Accessible at: /api/openapi.json

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

  res.status(200).json({
    openapi: "3.0.0",
    info: {
      title: "CodeArena API",
      description: "CodeArena API for coding and prompt practice, real-time human battles, rankings, profiles, and community-created games.",
      version: "1.0.0",
      contact: {
        name: "CodeArena Support",
        email: "support@codearena.co",
        url: "https://codearena.co/about"
      },
      termsOfService: "https://codearena.co/terms",
      "x-logo": {
        url: "https://codearena.co/og-image-v3.png"
      }
    },
    servers: [
      {
        url: "https://api.codearena.co",
        description: "Production server"
      }
    ],
    tags: [
      {
        name: "Problems",
        description: "1000+ algorithm problems for practice and battles"
      },
      {
        name: "Users",
        description: "User profiles and ELO rankings"
      },
      {
        name: "Leaderboard",
        description: "Global and weekly leaderboards"
      }
    ],
    paths: {
      "/api/problems-meta": {
        get: {
          tags: ["Problems"],
          summary: "Get all problems metadata",
          description: "Returns a list of all available coding problems with titles, difficulty, and categories",
          responses: {
            "200": {
              description: "List of problems",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      problems: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            title: { type: "string" },
                            difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/leaderboard": {
        get: {
          tags: ["Leaderboard"],
          summary: "Get global leaderboard",
          description: "Returns top players by ELO rating",
          parameters: [
            {
              name: "limit",
              in: "query",
              description: "Number of players to return",
              schema: { type: "integer", default: 50 }
            }
          ],
          responses: {
            "200": {
              description: "Leaderboard data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      leaderboard: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            username: { type: "string" },
                            rating: { type: "integer" },
                            rank: { type: "string" },
                            wins: { type: "integer" },
                            losses: { type: "integer" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        Problem: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique problem identifier" },
            title: { type: "string", description: "Problem title" },
            difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] },
            description: { type: "string", description: "Problem description in markdown" }
          }
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            username: { type: "string" },
            rating: { type: "integer", description: "ELO rating" },
            rank: { type: "string", enum: ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Grandmaster"] },
            wins: { type: "integer" },
            losses: { type: "integer" }
          }
        }
      }
    },
    externalDocs: {
      description: "CodeArena Documentation",
      url: "https://codearena.co/about"
    }
  });
}
