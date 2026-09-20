// ============================================================================
// FIELD EVENTS BRIDGE — CLOUD RELAY
//
// A small, deliberately dumb message pipe. It does NOT validate marks, rank
// results, or write .lff files — that logic stays on the timing laptop
// (submissionProcessor.js), which is the only place with the live .evt file
// and EMM's shared folder. This relay only:
//   - mirrors the current schedule (pushed by the laptop) so judges' phones
//     can see the event list even when they can't reach the laptop directly,
//   - accepts submissions from judges over the open internet (their mobile
//     data) and queues them,
//   - lets the laptop pull the queue, and reports back what the laptop
//     decided (accepted + filename, or the exact validation error) so the
//     judge's phone can show a real result, not just "we got your message."
//
// Everything here is IN-MEMORY. A restart of the free host clears the
// schedule mirror and any not-yet-processed submissions — that's a real
// limitation of using a free tier for this, not a bug. Local Wi-Fi/hotspot
// submission (server.js on the laptop) is unaffected by any of this and
// should stay your first choice whenever a judge is in range of it.
// ============================================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const { findOfficial, eventAllowedForOfficial } = require('./officials');

const app = express();
const PORT = process.env.PORT || 3000;
const SYNC_SECRET = process.env.SYNC_SECRET || '';
const startTime = Date.now();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
let schedule = { events: [], officials: [], legacyPin: null, updatedAt: null };
let submissions = []; // { id, pin, body, receivedAt, status, resultBody, processingSince }
let nextId = 1;
const PROCESSING_TIMEOUT_MS = 30000; // if the laptop never acks, retry after this

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function requireSyncSecret(req, res, next) {
  if (!SYNC_SECRET) {
    return res.status(500).json({ success: false, error: 'This relay has no SYNC_SECRET configured — set it in your host\'s environment variables before use.' });
  }
  if (req.header('x-sync-secret') !== SYNC_SECRET) {
    return res.status(401).json({ success: false, error: 'Invalid sync secret.' });
  }
  next();
}

function requirePin(req, res, next) {
  const pin = req.header('x-access-pin');
  const official = findOfficial(pin, schedule.officials, schedule.legacyPin);
  if (!official) {
    return res.status(401).json({ success: false, error: 'Invalid or missing access PIN.' });
  }
  req.official = official;
  req.pin = pin;
  next();
}

// ---------------------------------------------------------------------------
// Health check — open this URL in a browser to confirm the relay is alive
// and see roughly how fresh the schedule mirror is.
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    success: true,
    scheduleUpdatedAt: schedule.updatedAt,
    eventCount: schedule.events.length,
    pendingCount: submissions.filter((s) => s.status === 'pending').length,
    totalSubmissions: submissions.length,
  });
});

// ---------------------------------------------------------------------------
// LAPTOP <-> RELAY sync endpoints
// ---------------------------------------------------------------------------
app.post('/sync/push-schedule', requireSyncSecret, (req, res) => {
  const { events, officials, legacyPin } = req.body || {};
  schedule = {
    events: Array.isArray(events) ? events : [],
    officials: Array.isArray(officials) ? officials : [],
    legacyPin: legacyPin || null,
    updatedAt: new Date().toISOString(),
  };
  res.json({ success: true });
});

app.get('/sync/pending', requireSyncSecret, (req, res) => {
  const now = Date.now();
  const due = submissions.filter((s) => {
    if (s.status === 'pending') return true;
    // A submission stuck "processing" for too long (laptop crashed/restarted
    // mid-cycle without acking) is handed out again rather than lost.
    if (s.status === 'processing' && now - s.processingSince > PROCESSING_TIMEOUT_MS) return true;
    return false;
  });
  due.forEach((s) => {
    s.status = 'processing';
    s.processingSince = now;
  });
  res.json({
    success: true,
    pending: due.map((s) => ({ id: s.id, pin: s.pin, body: s.body, receivedAt: s.receivedAt })),
  });
});

app.post('/sync/ack', requireSyncSecret, (req, res) => {
  const { id, status, resultBody } = req.body || {};
  const submission = submissions.find((s) => s.id === id);
  if (!submission) return res.status(404).json({ success: false, error: 'Unknown submission id.' });
  submission.status = status === 'processed' ? 'processed' : 'error';
  submission.resultBody = resultBody || null;
  submission.processedAt = new Date().toISOString();
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// PHONE <-> RELAY endpoints — same shapes as the local server.js, so
// public/index.html works unchanged against either.
// ---------------------------------------------------------------------------
app.get('/api/events', requirePin, (req, res) => {
  const events = schedule.events.filter((e) => eventAllowedForOfficial(e.eventCode, req.official));
  res.json({ success: true, events, official: { role: req.official.role || null } });
});

app.get('/api/last-submission', requirePin, (req, res) => {
  const { eventId, roundId, flightId } = req.query;
  const match = [...submissions].reverse().find(
    (s) =>
      s.status === 'processed' &&
      s.resultBody && s.resultBody.success &&
      String(s.body.eventId) === String(eventId) &&
      String(s.body.roundId) === String(roundId) &&
      String(s.body.flightId) === String(flightId)
  );
  res.json({
    success: true,
    last: match ? { officialName: match.body.officialName || null, submittedAt: match.receivedAt } : null,
  });
});

app.post('/api/save-lif', requirePin, (req, res) => {
  const body = req.body || {};
  if (!body.eventId || !body.roundId || !body.flightId || !Array.isArray(body.results) || body.results.length === 0) {
    return res.status(400).json({ success: false, error: 'Missing eventId, roundId, flightId, or results.' });
  }
  if (!body.officialName || !String(body.officialName).trim()) {
    return res.status(400).json({ success: false, error: 'Enter your name before submitting — required so we know who to contact about this entry.' });
  }

  // Quick scope check using the cached schedule, so an out-of-scope PIN is
  // rejected immediately rather than sitting in the queue until the laptop
  // catches it. The laptop re-checks everything authoritatively regardless.
  const matchingEvent = schedule.events.find(
    (e) => String(e.eventId) === String(body.eventId) &&
           String(e.roundId) === String(body.roundId) &&
           String(e.flightId) === String(body.flightId)
  );
  if (matchingEvent && !eventAllowedForOfficial(matchingEvent.eventCode, req.official)) {
    return res.status(403).json({
      success: false,
      error: `Your access PIN isn't authorized for this event (${matchingEvent.eventName || matchingEvent.eventCode}).`,
    });
  }

  const id = nextId++;
  submissions.push({
    id,
    pin: req.pin,
    body,
    receivedAt: new Date().toISOString(),
    status: 'pending',
    resultBody: null,
  });

  res.json({ success: true, submissionId: id, status: 'pending' });
});

app.get('/api/status/:id', requirePin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const submission = submissions.find((s) => s.id === id);
  if (!submission) return res.status(404).json({ success: false, error: 'Unknown submission id.' });
  res.json({ success: true, status: submission.status, result: submission.resultBody });
});

// Same shape as the laptop's /api/status, built from this relay's own
// in-memory queue, so public/status.html renders sensibly here too — useful
// as a second dashboard confirming what's arriving from mobile data.
app.get('/api/status', (req, res) => {
  const recentSubmissions = [...submissions]
    .reverse()
    .slice(0, 20)
    .map((s) => ({
      submitted_at: s.receivedAt,
      event_id: s.body.eventId,
      round_id: s.body.roundId,
      flight_id: s.body.flightId,
      event_name: s.body.eventName,
      lif_filename: s.resultBody && s.resultBody.file ? s.resultBody.file : null,
      write_status: s.status === 'processed' ? 'ok' : s.status === 'error' ? 'error' : 'pending',
      error_message: s.resultBody && !s.resultBody.success ? s.resultBody.error : null,
      official_name: s.body.officialName || null,
      official_phone: s.body.officialPhone || null,
    }));

  res.json({
    success: true,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    dataDir: '(cloud relay — no local EMM folder)',
    evtFile: schedule.updatedAt ? `schedule mirrored from laptop at ${schedule.updatedAt}` : '(no schedule synced yet)',
    recentSubmissions,
    recentErrors: [],
  });
});

app.listen(PORT, () => {
  console.log(`Field Events Cloud Relay listening on port ${PORT}`);
  console.log(SYNC_SECRET ? 'SYNC_SECRET is set.' : 'WARNING: SYNC_SECRET is NOT set — sync endpoints will refuse all requests until you set it.');
});
