import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'CodeArena',
    url: 'https://codearena.co',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    description: 'A developer community for coding and prompt practice, live battles, rankings, tournaments, friends, and community-created games.',
    featureList: [
      'Coding practice',
      'Prompt practice',
      'Real-time coding and prompt battles',
      'Friend challenges and rematches',
      'Human tournaments and leaderboards',
      'CreatorArena and community gallery',
    ],
  };

  return (
    <Html lang="en">
      <Head>
        <meta name="description" content="Practice coding and prompting, battle developers live, challenge friends, climb rankings, and create community games." />
        <meta name="keywords" content="coding practice, prompt practice, coding battle, prompt battle, competitive programming, multiplayer coding, developer community" />
        <meta name="theme-color" content="#020617" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico?v=2" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=2" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=2" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="CodeArena" />
        <meta property="og:title" content="CodeArena - Practice, Battle, and Build Together" />
        <meta property="og:description" content="Coding and prompt practice with live human battles, friends, rankings, tournaments, and community-created games." />
        <meta property="og:url" content="https://codearena.co" />
        <meta property="og:image" content="https://codearena.co/og-image-v3.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="CodeArena - Practice, Battle, and Build Together" />
        <meta name="twitter:description" content="Practice coding and prompting, then compete live with friends and developers worldwide." />
        <meta name="twitter:image" content="https://codearena.co/og-image-v3.png" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://api.fontshare.com" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
