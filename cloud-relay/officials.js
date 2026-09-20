// ============================================================================
// Identical copy of the main app's officials.js — duplicated here because
// this folder is deployed standalone (its own host, own npm install) and
// can't reach back into the parent project's files once deployed. If you
// ever change PIN-scoping rules, change both copies.
// ============================================================================
function findOfficial(pin, officials, legacyPin) {
  if (!pin) return null;
  if (Array.isArray(officials) && officials.length > 0) {
    return officials.find((o) => o.pin === pin) || null;
  }
  if (legacyPin && pin === legacyPin) {
    return { pin, role: 'All events (shared PIN)', allowedEventCodes: '*' };
  }
  return null;
}

function eventAllowedForOfficial(eventCode, official) {
  if (!official || official.allowedEventCodes === '*' || !Array.isArray(official.allowedEventCodes)) return true;
  const prefix = (eventCode || '').replace(/[0-9]+$/, '').toUpperCase();
  return official.allowedEventCodes.includes(prefix);
}

module.exports = { findOfficial, eventAllowedForOfficial };
