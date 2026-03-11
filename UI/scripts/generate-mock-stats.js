const http = require('http');

function makeHourlyArray(scale = 1.0) {
  // simple deterministic mock: ramp up during work hours
  return new Array(24).fill(0).map((_, h) => {
    if (h >= 9 && h <= 17) return Math.round((Math.sin((h - 9) / 8 * Math.PI) * 30 + 10) * 60 * scale);
    if (h >= 7 && h < 9) return Math.round(5 * 60 * scale);
    if (h > 17 && h <= 21) return Math.round(10 * 60 * scale);
    return 0;
  });
}

function dateString(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Variation multipliers per day so days look slightly different
const scales = [1.0, 0.85, 1.1, 0.6, 0.95, 0.75, 1.2];

const daily_totals_seconds = {};
const daily_app_totals_seconds = {};
const daily_hourly_seconds = {};

for (let i = 0; i < 7; i++) {
  const date = dateString(i);
  const s = scales[i];

  daily_totals_seconds[date] = {
    Development:   Math.round(5 * 3600 * s),
    Browsing:      Math.round(2.5 * 3600 * s),
    Entertainment: Math.round(1 * 3600 * s),
    System:        Math.round(0.5 * 3600 * s)
  };

  daily_app_totals_seconds[date] = {
    'code.exe':     Math.round(5 * 3600 * s),
    'chrome.exe':   Math.round(2.5 * 3600 * s),
    'spotify.exe':  Math.round(1 * 3600 * s),
    'explorer.exe': Math.round(0.5 * 3600 * s)
  };

  daily_hourly_seconds[date] = {
    Development:   makeHourlyArray(s),
    Browsing:      makeHourlyArray(s).map(v => Math.round(v * 0.5)),
    Entertainment: makeHourlyArray(s).map((v, h) => (h >= 18 && h <= 21 ? Math.round(20 * 60 * s) : 0)),
    System:        new Array(24).fill(Math.round(60 * s))
  };
}

const state = {
  rules: {
    'code.exe':     'Development',
    'chrome.exe':   'Browsing',
    'explorer.exe': 'System',
    'spotify.exe':  'Entertainment'
  },
  totals_seconds: {},
  app_totals_seconds: {
    'code.exe':     5 * 3600,
    'chrome.exe':   2.5 * 3600,
    'spotify.exe':  1 * 3600,
    'explorer.exe': 0.5 * 3600
  },
  daily_totals_seconds,
  daily_app_totals_seconds,
  daily_hourly_seconds,
  category_colors: {
    Development:   '#E9BCB5',
    Browsing:      '#927AD4',
    Entertainment: '#ECE5F0',
    System:        '#52508B'
  },
  retention_days: 30
};

const postData = JSON.stringify({ state });

const options = {
  hostname: '127.0.0.1',
  port: 8000,
  path: '/settings/import-state',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data || '{}');
      if (res.statusCode === 200 && parsed.ok) {
        console.log('[mock] imported mock stats successfully (7 days)');
      } else {
        console.error('[mock] import failed', res.statusCode, parsed);
      }
    } catch (err) {
      console.error('[mock] unexpected response', res.statusCode, data);
    }
  });
});

req.on('error', (e) => {
  console.error('[mock] request error', e.message);
});

req.write(postData);
req.end();
