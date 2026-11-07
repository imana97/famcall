if (typeof RUN_ID === 'undefined' || !/^[0-9a-f-]{36}$/.test(RUN_ID) ||
    !/^(caller|callee)$/.test(ROLE) || !/^(ready|ringing|blocked|blockChecked|unblocked|connected|finished)$/.test(STAGE)) {
  throw new Error('A run UUID, endpoint role and call stage are required.');
}
var base = 'http://bs-local.com:8787';
var response;
if (ACTION === 'mark') {
  response = http.post(base + '/event', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run: RUN_ID, role: ROLE, stage: STAGE })
  });
} else if (ACTION === 'wait') {
  var age = typeof MIN_AGE_MS === 'undefined' ? 0 : Number(MIN_AGE_MS);
  if (!isFinite(age) || age < 0 || age > 30000) throw new Error('Invalid minimum event age.');
  var deadline = Date.now() + 90000;
  var ready = false;
  while (Date.now() < deadline) {
    response = http.get(base + '/event?run=' + encodeURIComponent(RUN_ID) + '&role=' + ROLE + '&stage=' + STAGE);
    if (!response.ok) throw new Error('Call synchronization failed: ' + response.status);
    var observed = JSON.parse(response.body);
    if (observed.at && observed.elapsed >= age) { ready = true; break; }
  }
  if (!ready) throw new Error('The other call endpoint did not reach ' + STAGE + ' in time.');
} else {
  throw new Error('Unknown call synchronization action.');
}
if (!response.ok) throw new Error('Call synchronization failed: ' + response.status);
var event = JSON.parse(response.body);
output.callEventAt = event.at;
