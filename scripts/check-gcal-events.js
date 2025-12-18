const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function main() {
  // Load credentials
  const credentialsPath = path.join(__dirname, '..', 'packages', 'connector', 'oauth_credentials.json');
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

  const oauth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    'http://localhost:3000/oauth2callback'
  );

  oauth2Client.setCredentials({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Get events from Dec 2-6, 2025
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: '2025-12-02T00:00:00+09:00',
    timeMax: '2025-12-07T00:00:00+09:00',
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items || [];

  // Group by date
  const byDate = {};
  for (const event of events) {
    const start = event.start?.dateTime || event.start?.date;
    if (!start) continue;
    const date = start.slice(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push({
      summary: event.summary,
      colorId: event.colorId,
      start: start.slice(11, 16),
    });
  }

  // Print events with colorId 7 (Peacock) or 9 (Blueberry)
  for (const date of Object.keys(byDate).sort()) {
    console.log(`\n${date}:`);
    for (const e of byDate[date]) {
      if (e.colorId === '7' || e.colorId === '9') {
        const colorName = e.colorId === '7' ? 'Peacock' : 'Blueberry';
        console.log(`  ${e.start} ${e.summary} - colorId=${e.colorId} (${colorName})`);
      }
    }
  }
}

main().catch(console.error);
