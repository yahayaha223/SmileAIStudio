"use strict";
const KEY = 'global-v1', RESERVE = 4320, DAY = 86400000;
function reject(code) { const e = new Error(code); e.status = code === 'usage_unavailable' ? 503 : 429; throw e; }
async function change(store, now, mutate) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await store.getWithMetadata(KEY, { type: 'json', consistency: 'strong' });
    let rows = [];
    if (current) {
      if (!current.etag || !current.data || current.data.version !== 1 || !Array.isArray(current.data.rows)) reject('usage_unavailable');
      rows = current.data.rows;
      // Later reservations can exist when an earlier request records its result.
      // Keep future timestamps in every window (conservative under clock skew).
      if (rows.length > 300 || rows.some(r => !r || !Number.isFinite(r.at) || r.at < 0 ||
          typeof r.id !== 'string' || !/^[\da-f-]{36}$/i.test(r.id) || r.reserved !== RESERVE ||
          !['reserved', 'completed', 'failed_or_unknown'].includes(r.status)) ||
          new Set(rows.map(r => r.id)).size !== rows.length) reject('usage_unavailable');
    }
    rows = rows.filter(r => r.at > now - 30 * DAY);
    mutate(rows);
    const result = await store.setJSON(KEY, { version: 1, rows }, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
    if (result && result.modified === true && result.etag) return;
    if (!result || result.modified !== false) reject('usage_unavailable');
  }
  reject('usage_unavailable');
}
async function reserve(store, id, now) {
  return change(store, now, rows => {
    if (rows.some(r => r.id === id)) { const e = new Error('duplicate_request'); e.status = 409; throw e; }
    const recent = rows.filter(r => r.at > now - 600000), daily = rows.filter(r => r.at > now - DAY);
    if (recent.length >= 6 || daily.length >= 30 || rows.length >= 300 || (daily.length + 1) * RESERVE > 150000 || (rows.length + 1) * RESERVE > 1500000) reject('budget_limit');
    rows.push({ id, at: now, reserved: RESERVE, status: 'reserved' });
  });
}
async function record(store, id, now, result) {
  return change(store, now, rows => {
    const row = rows.find(r => r.id === id); if (!row) reject('usage_unavailable');
    row.status = result ? 'completed' : 'failed_or_unknown';
    if (result) { row.model = result.model; row.usage = result.usage; row.estimatedModelCostUSD = result.estimatedModelCostUSD; }
  });
}
module.exports = { reserve, record, RESERVE };
