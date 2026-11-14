'use strict';
const ORIGIN = 'https://play.gigglemeet.com';
const SITE_NAME = 'Giggle Games';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Registry facts supply the same title, rules and player range as the page.
// Authored pages keep their body, style graph and scripts; only shared search
// metadata in the head is replaced during their normal publication build.
function gamePageSEO(html, game) {
  const url = `${ORIGIN}/games/${game.id}/`;
  const title = `${game.name} — ${SITE_NAME}`;
  const text = `${game.tagline}. ${game.howto}`.replace(/\s+/g, ' ').trim();
  const description = text.length > 155 ? text.slice(0, 151).replace(/\s+\S*$/, '') + '…' : text;
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@type': ['Game', 'WebApplication'], '@id': url + '#game', name: game.name, url, description,
    applicationCategory: 'GameApplication', operatingSystem: 'Web browser', isAccessibleForFree: true,
    numberOfPlayers: { '@type': 'QuantitativeValue', minValue: game.minPlayers, maxValue: game.maxPlayers },
    isPartOf: { '@id': ORIGIN + '/#website' }, publisher: { '@id': ORIGIN + '/#organization' }, image: ORIGIN + '/og.png',
  }).replace(/[<>&]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  const metadata = `<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Giggle Games — the looping GG with a wink on amber">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${ORIGIN}/og.png">
<script type="application/ld+json">${schema}</script>`;
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, head => head
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b(?=[^>]*(?:name\s*=\s*["'](?:description|twitter:[^"']+)["']|property\s*=\s*["']og:[^"']+["']))[^>]*>/gi, '')
    .replace(/<link\b(?=[^>]*rel\s*=\s*["']canonical["'])[^>]*>/gi, '')
    .replace(/<\/head>/i, metadata + '\n</head>'));
}

module.exports = { ORIGIN, SITE_NAME, gamePageSEO };
