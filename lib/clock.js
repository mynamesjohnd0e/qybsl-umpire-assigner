// The one clock for the whole app.
//
// Every place in lib/ and server.js that needs "right now" asks clock.now()
// instead of calling new Date() or Date.now() itself. In production nothing
// freezes the clock, so now() is just the real wall clock. In tests we can
// stop time or travel to a chosen moment, so a deadline, a reminder or a
// "has the game started?" check can be tested on both sides of its line
// without waiting for real time to pass.
//
// Only use this for "now". Parsing a stored date (new Date(game.start)) or
// seeding a random id is not "now" and does not belong here.
let frozen = null;

// The current moment, as a Date. A fresh Date each call so callers can mutate
// it freely.
function now() {
  return frozen === null ? new Date() : new Date(frozen);
}

// Freeze time at `when` (a Date, an ISO string, or epoch ms). Pass null to go
// back to the real clock. Tests call this; production never does.
function setNow(when) {
  if (when === null || when === undefined) { frozen = null; return; }
  frozen = when instanceof Date ? when.getTime() : new Date(when).getTime();
}

// Back to the real wall clock.
function reset() { frozen = null; }

// Is time currently frozen? (Handy for test assertions.)
function isFrozen() { return frozen !== null; }

module.exports = { now, setNow, reset, isFrozen };
