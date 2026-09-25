// Paste into javascript_tool ~10-15 s after ws_hook.js, once the board is rendered.
// Decodes the captured WebSocket frames, rebuilds board objects, links captions and group
// headers to images, fetches file sizes, and leaves everything in window.__mbx.
// Returns a short summary; the full export is JSON.stringify(window.__mbx.export).
const M = window.__mbx;
if (!M || !M.raw.length) throw new Error('No captured frames: ws_hook.js ran too late or not at all. Navigate to the link again and run ws_hook.js in the same browser_batch.');

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter(); w.write(bytes).catch(() => {}); w.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
// Most payloads are zlib-compressed after a short binary header (0x78 0x9c / 0xda / 0x01 / 0x5e).
const chunks = [];
for (const b of M.raw) {
  let s = null;
  for (let j = 0; j < Math.min(b.length - 1, 64); j++) {
    if (b[j] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(b[j + 1])) {
      try { s = new TextDecoder().decode(await inflate(b.slice(j))); break; } catch (e) {}
    }
  }
  chunks.push(s ?? new TextDecoder().decode(b));
}
const all = chunks.join('\n');

// Every board object is a JSON blob with a `_position`; the widget type name sits just before it.
const found = [];
let i = 0;
while ((i = all.indexOf('{"', i)) !== -1) {
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let k = i; k < all.length; k++) {
    const c = all[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { if (--depth === 0) { end = k; break; } }
  }
  if (end < 0) break;
  let o = null; try { o = JSON.parse(all.slice(i, end + 1)); } catch (e) {}
  if (o && o._position && o._position.offsetPx) {
    const hint = (all.slice(Math.max(0, i - 40), i).match(/([a-z_]{3,})[^a-z_]*$/i) || [])[1] || '';
    found.push({ o, hint: hint.toLowerCase() });
    i = end + 1;
  } else i++;
}

const strip = s => (s || '').replace(/<\/p>|<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n+/g, '\n').trim();
const oneLine = s => s.replace(/\n/g, ' ');
const kindOf = ({ o, hint }) => o.resource ? 'image'
  : (o.contentManagement !== undefined || o.isClusteringContainer !== undefined) ? 'frame'
  : (hint === 'sticker' || (o.text !== undefined && o.rotation === undefined && o['ns:author'] !== undefined)) ? 'sticker'
  : o.text !== undefined ? 'text'
  : o.content !== undefined ? 'shape' : (hint || 'other');

const seen = new Set();
const objs = [];
for (const f of found) {
  const o = f.o, kind = kindOf(f), sc = o.scale?.scale || 1;
  const w = o.size ? o.size.width * sc : o.crop ? o.crop.width * sc : (o.resource?.width || 0) * sc;
  const h = o.size ? o.size.height * sc : o.crop ? o.crop.height * sc : (o.resource?.height || 0) * sc;
  const x = o._position.offsetPx.x, y = o._position.offsetPx.y;
  const rawText = o.text ?? o.content ?? null;
  const key = [kind, Math.round(x), Math.round(y), o.resource?.id || rawText || o.name || ''].join('|');
  if (seen.has(key)) continue;
  seen.add(key);
  objs.push({ kind, x, y, w, h, parent: o._parent?.id || null, rid: o.resource?.id, name: o.resource?.name,
    frameName: kind === 'frame' ? (o.name || '') : undefined,
    rawText, text: rawText != null ? strip(rawText) : undefined });
}

const images = objs.filter(o => o.kind === 'image');
const texts = objs.filter(o => o.kind === 'text' || o.kind === 'shape').filter(t => t.text);
// Headers = fully bold text, or text whose line height is clearly bigger than a typical caption's.
const lineH = t => t.h / Math.max(1, t.text.split('\n').length);
const isBold = t => /<(strong|b)>/.test(t.rawText) && strip(t.rawText.replace(/<(strong|b)>[\s\S]*?<\/\1>/g, '')) === '';
const plainLH = texts.filter(t => !isBold(t)).map(lineH).sort((a, b) => a - b);
const medLH = plainLH.length ? plainLH[Math.floor(plainLH.length / 2)] : 0;
const heads = texts.filter(t => !t.parent && (isBold(t) || (medLH && lineH(t) >= 1.8 * medLH)));
const caps = texts.filter(t => !heads.includes(t));
const imgH = images.map(im => im.h).sort((a, b) => a - b);
const H = imgH.length ? imgH[Math.floor(imgH.length / 2)] : 2000;   // typical image height, scales the heuristics

// Caption -> the image directly ABOVE it (caption sits under the photo).
const capOf = new Map();
const unmatchedCaptions = [];
for (const c of caps) {
  if (c.parent) { unmatchedCaptions.push(oneLine(c.text) + ' (inside frame)'); continue; }
  let best = null;
  for (const im of images) {
    if (im.parent) continue;
    const dy = c.y - im.y, dx = Math.abs(c.x - im.x);
    if (dy > 0 && dy < im.h / 2 + Math.max(300, 0.45 * im.h) && dx < im.w / 2 + 300) {
      const s = dx + Math.abs(dy - im.h / 2);
      if (!best || s < best.s) best = { s, im };
    }
  }
  if (best) capOf.set(best.im, [...(capOf.get(best.im) || []), oneLine(c.text)]);
  else unmatchedCaptions.push(oneLine(c.text));
}
// Image -> nearest header above it whose horizontal band covers the image.
const groupOf = im => {
  if (im.parent) return null;
  const c = heads.filter(h => {
    const left = h.x - h.w / 2, dy = im.y - h.y;
    return dy > 0.1 * H && dy < 2.75 * H && im.x >= left - 0.75 * H && im.x <= left + 4.5 * H;
  }).sort((a, b) => (im.y - a.y) - (im.y - b.y));
  return c.length ? oneLine(c[0].text) : null;
};

// Unique files to download (the same resource can be placed on the board several times).
const files = [];
const byRid = new Map();
const usedNames = new Set();
for (const im of images) {
  if (!im.rid || byRid.has(im.rid)) continue;
  let save = (im.name || im.rid + '.png').replace(/[\\/:*?"<>|]/g, '_');
  if (usedNames.has(save.toLowerCase())) save = save.replace(/(\.[^.]*)?$/, `__${im.rid.slice(-6)}$1`);
  usedNames.add(save.toLowerCase());
  const f = { rid: im.rid, name: im.name, save };
  byRid.set(im.rid, f); files.push(f);
}

// File sizes from the metadata endpoint (Miro's figure runs ~15% under the real download size).
const boardId = encodeURIComponent(decodeURIComponent(location.pathname.match(/\/board\/([^/]+)/)[1]));
for (let k = 0; k < files.length; k += 40) {
  const q = files.slice(k, k + 40).map(f => 'ids=' + f.rid).join('&');
  try {
    const j = await (await fetch(`/api/v1/boards/${boardId}/resources/batch/meta?${q}`, { credentials: 'include' })).json();
    for (const d of j.data || []) { const f = byRid.get(d.id); if (f) { f.bytes = d.meta?.filesize; f.dims = `${d.meta?.width}x${d.meta?.height}`; } }
  } catch (e) {}
}
const totalMB = files.reduce((a, f) => a + (f.bytes || 0), 0) / 1048576;

const frames = objs.filter(o => o.kind === 'frame').map(f => ({ name: f.frameName }));
const childrenByParent = {};
for (const im of images.filter(im => im.parent)) (childrenByParent[im.parent] ||= []).push(byRid.get(im.rid)?.save || im.name);

M.boardId = boardId;
M.files = files;
M.export = {
  board: document.title.replace(/\s*-\s*Miro\s*$/, ''),
  link: location.href.split('?')[0],
  exported: new Date().toISOString().slice(0, 10),
  note: 'group/caption are inferred from object positions on the board; null = not under any header',
  groups: heads.map(h => oneLine(h.text)),
  stickers: objs.filter(o => o.kind === 'sticker' && o.text).map(s => oneLine(s.text)),
  frames,
  frame_children: childrenByParent,
  unmatched_captions: unmatchedCaptions,
  items: images.filter(im => !im.parent).map(im => ({ file: byRid.get(im.rid)?.save || im.name, group: groupOf(im), caption: (capOf.get(im) || []).join(' | ') || null }))
};
({
  capturedFrames: M.raw.length, objects: objs.length,
  imagesPlaced: images.length, uniqueFiles: files.length, approxTotalMB: +(totalMB * 1.15).toFixed(0),
  headers: heads.length, captions: caps.length, linkedCaptions: [...capOf.values()].flat().length,
  unmatchedCaptions: unmatchedCaptions.length, itemsWithoutGroup: M.export.items.filter(x => !x.group).length,
  stickers: M.export.stickers.length, frames: frames.map(f => f.name), framesWithChildren: Object.keys(childrenByParent).length,
  sampleFiles: files.slice(0, 3).map(f => `${f.save} ${f.dims || ''}`)
})
