/* Persistent owner-controlled command channel for TizenBrew's Node.js 4.4.3. */
'use strict';

var fs = require('fs');
var http = require('http');
var childProcess = require('child_process');
var CONFIG_PATH = '/home/owner/share/tizenbrew-shell-config.json';
var DEFAULT_POLL_MS = 2000;
var DEFAULT_HOST = '192.168.0.73';
var DEFAULT_PORT = 8009;
var busy = false;

function normalizedConfig(value) {
  if (!value.host || !value.port || !value.token) {
    throw new Error('channel config requires host, port, and token');
  }
  return {
    host: String(value.host),
    port: Number(value.port),
    token: String(value.token),
    pollMs: Number(value.poll_interval_ms || DEFAULT_POLL_MS)
  };
}

function loadConfig() {
  var path = process.env.TIZENBREW_SHELL_CONFIG || CONFIG_PATH;
  return normalizedConfig(JSON.parse(fs.readFileSync(path, 'utf8')));
}

function request(config, method, path, body, callback) {
  var payload = body === null ? null : JSON.stringify(body);
  var headers = {
    'Authorization': 'Bearer ' + config.token,
    'Connection': 'close'
  };
  if (payload !== null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  var req = http.request({
    hostname: config.host,
    port: config.port,
    path: path,
    method: method,
    headers: headers
  }, function (response) {
    var chunks = [];
    response.on('data', function (chunk) { chunks.push(chunk); });
    response.on('end', function () {
      callback(null, response.statusCode, Buffer.concat(chunks).toString('utf8'));
    });
  });
  req.setTimeout(5000, function () {
    req.abort();
    callback(new Error('request timeout'));
  });
  req.on('error', function (error) { callback(error); });
  if (payload !== null) req.write(payload);
  req.end();
}
function loadOrPairConfig(callback) {
  var path = process.env.TIZENBREW_SHELL_CONFIG || CONFIG_PATH;
  try {
    callback(null, loadConfig());
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      callback(error);
      return;
    }
  }

  var value = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    token: require('crypto').randomBytes(24).toString('hex'),
    poll_interval_ms: DEFAULT_POLL_MS
  };
  var config = normalizedConfig(value);
  request(config, 'POST', '/pair', {
    token: value.token,
    marker: 'tizenbrew-command-channel-pair-v1'
  }, function (error, status) {
    if (error || status !== 200) {
      callback(error || new Error('pairing refused with HTTP ' + status));
      return;
    }
    try {
      fs.writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 384 });
      fs.chmodSync(path, 384);
      callback(null, config);
    } catch (writeError) {
      callback(writeError);
    }
  });
}

function postResult(config, result, done) {
  request(config, 'POST', '/result', result, function () {
    done();
  });
}

function execute(config, task) {
  busy = true;
  var started = Date.now();
  var timeout = Math.max(1000, Math.min(Number(task.timeout_ms || 15000), 60000));
  childProcess.exec(String(task.command), {
    timeout: timeout,
    maxBuffer: 1024 * 1024
  }, function (error, stdout, stderr) {
    postResult(config, {
      id: String(task.id),
      command: String(task.command),
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      error: error ? error.message : null,
      stdout: String(stdout || ''),
      stderr: String(stderr || '')
    }, function () {
      busy = false;
      setTimeout(function () { poll(config); }, config.pollMs);
    });
  });
}

function poll(config) {
  if (busy) return;
  request(config, 'GET', '/next', null, function (error, status, body) {
    if (!error && status === 200) {
      try {
        execute(config, JSON.parse(body));
        return;
      } catch (parseError) {
        console.error('Invalid command response: ' + parseError.message);
      }
    }
    setTimeout(function () { poll(config); }, config.pollMs);
  });
}

function main() {
  loadOrPairConfig(function (error, config) {
    if (error) {
      console.error('Command channel configuration failed: ' + error.message);
      return;
    }

    request(config, 'POST', '/result', {
      id: 'hello-' + process.pid,
      command: null,
      error: null,
      stdout: JSON.stringify({
        marker: 'tizenbrew-command-channel-v1',
        pid: process.pid,
        uid: process.getuid ? process.getuid() : null,
        gid: process.getgid ? process.getgid() : null,
        node: process.version,
        arch: process.arch,
        platform: process.platform
      }),
      stderr: ''
    }, function () {
      poll(config);
    });
  });
}

main();
