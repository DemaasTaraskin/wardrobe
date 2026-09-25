// Paste into javascript_tool in the SAME browser_batch, right after `navigate` to the board link.
// Miro streams board objects (images, texts, stickers, frames) over a WebSocket that opens a few
// seconds after page load. Wrapping the constructor now captures every frame of that initial load.
// Objects already loaded are never re-sent, so if this runs too late, navigate again and re-run.
window.__mbx = { raw: [], sockets: [], hookedAt: performance.now() };
(() => {
  const Orig = window.WebSocket;
  window.WebSocket = new Proxy(Orig, {
    construct(target, args) {
      const ws = new target(...args);
      window.__mbx.sockets.push(String(args[0]).split('?')[0]);
      ws.addEventListener('message', ev => {
        const d = ev.data;
        if (d instanceof ArrayBuffer) window.__mbx.raw.push(new Uint8Array(d.slice(0)));
        else if (typeof d === 'string') window.__mbx.raw.push(new TextEncoder().encode(d));
        else if (d instanceof Blob) d.arrayBuffer().then(b => window.__mbx.raw.push(new Uint8Array(b)));
      });
      return ws;
    }
  });
})();
`hooked at ${performance.now().toFixed(0)} ms, readyState=${document.readyState}`
