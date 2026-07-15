"use strict";

var processed = Object.create(null);

function rememberEvent(eventId) {
  if (!eventId) return false;
  if (processed[eventId]) return true;
  processed[eventId] = Date.now();
  // light GC
  var keys = Object.keys(processed);
  if (keys.length > 500) {
    keys.slice(0, 200).forEach(function (k) { delete processed[k]; });
  }
  return false;
}

module.exports = {
  rememberEvent: rememberEvent
};
