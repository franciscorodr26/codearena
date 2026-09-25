// pages/sitemap.xml.js - Dynamic sitemap generator
import { config } from '../config/env';

const SITE_URL = 'https://codearena.co';

function generateSiteMap(problems, profiles) {
  const today = new Date().toISOString().split('T')[0];

  // Only include PUBLIC pages that Googlebot can access without authentication
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Public Static Pages -->
  <url>
    <loc>${SITE_URL}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/about</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${SITE_URL}/pricing</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${SITE_URL}/problems</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${SITE_URL}/privacy</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${SITE_URL}/terms</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${SITE_URL}/players</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${SITE_URL}/tournaments</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${SITE_URL}/challenge</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${SITE_URL}/gallery</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- LLM Discovery Files -->
  <url>
    <loc>${SITE_URL}/llms.txt</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>

  <!-- Problem Pages (${problems.length} problems) -->
  ${problems.map(problem => `
  <url>
    <loc>${SITE_URL}/problems/${problem.id}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('')}

  <!-- Public Profile Pages (${profiles.length} profiles) -->
  ${profiles.map(profile => `
  <url>
    <loc>${SITE_URL}/profile/${encodeURIComponent(profile.username)}</loc>
    <lastmod>${profile.created_at ? profile.created_at.split('T')[0] : today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`).join('')}
</urlset>`;
}

function SiteMap() {
  // getServerSideProps will handle the response
}

export async function getServerSideProps({ res }) {
  try {
    // Fetch all problem IDs and profile usernames from the backend in parallel
    const [problemsResponse, profilesResponse] = await Promise.all([
      fetch(`${config.backend_url}/api/problems?shuffle=false`),
      fetch(`${config.backend_url}/api/users/sitemap-usernames`)
    ]);

    const problemsData = await problemsResponse.json();
    const profilesData = await profilesResponse.json();

    const problems = problemsData.success ? problemsData.problems : [];
    const profiles = profilesData.success ? profilesData.usernames : [];

    // Generate the XML sitemap
    const sitemap = generateSiteMap(problems, profiles);

    res.setHeader('Content-Type', 'text/xml');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.write(sitemap);
    res.end();

    return {
      props: {}
    };
  } catch (error) {
    console.error('Sitemap generation error:', error);

    // Return a basic sitemap if the API fails
    const basicSitemap = generateSiteMap([], []);
    res.setHeader('Content-Type', 'text/xml');
    res.write(basicSitemap);
    res.end();

    return {
      props: {}
    };
  }
}

export default SiteMap;
