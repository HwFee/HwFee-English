// Evaluate a JS expression inside the running app's WebView (Chrome DevTools Protocol).
// Usage: node tools/invoke.mjs "Capacitor.Plugins.Lessons.list()"
// Requires: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>  (see tools/attach.ps1)
const port = Number(process.env.CDP_PORT || 9222);
let expression = process.argv[2];
if (!expression) {
  console.error('usage: node tools/invoke.mjs "<js expression>"   |   node tools/invoke.mjs @file.js');
  process.exit(2);
}
// "@file" lets complex expressions skip shell quoting entirely.
if (expression.startsWith('@')) {
  const { readFile } = await import('node:fs/promises');
  expression = await readFile(expression.slice(1), 'utf8');
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? targets.find((t) => t.webSocketDebuggerUrl);
if (!page) {
  console.error('no debuggable page. targets:', JSON.stringify(targets));
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = () => reject(new Error('devtools socket failed: ' + page.webSocketDebuggerUrl));
});

const reply = new Promise((resolve) => {
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === 1) resolve(message);
  };
});

socket.send(JSON.stringify({
  id: 1,
  method: 'Runtime.evaluate',
  params: { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true },
}));

const message = await reply;
socket.close();

if (message.result?.exceptionDetails) {
  console.error('exception:', JSON.stringify(message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails, null, 2));
  process.exit(1);
}
const value = message.result?.result?.value;
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
