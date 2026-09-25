// Paste into javascript_tool after extract_board.js. Edit START/END for each chunk (~32 files).
// Asks Miro for a short-lived signed CDN link to each original file and prints one compact line per
// file for download.py:  save_name|original_name|cdn_path|expires|signature|key_pair_id
// The `?redirect=false` form returns JSON; the plain endpoint redirects cross-origin and fails in-page.
// Links expire in ~15 minutes, so download each chunk right after generating it.
const START = 0, END = 32;
const M = window.__mbx;
if (!M?.files) throw new Error('Run extract_board.js first.');
const out = [];
for (const f of M.files.slice(START, END)) {
  try {
    const r = await fetch(`/api/v1/boards/${M.boardId}/resources/${f.rid}/files/original?redirect=false`, { credentials: 'include' });
    if (!r.ok) { out.push(`#FAIL ${f.save} HTTP ${r.status}`); continue; }
    const u = new URL((await r.json()).url);
    const p = u.searchParams;
    out.push([f.save, f.name, u.pathname, p.get('Expires'), p.get('Signature'), p.get('Key-Pair-Id')].join('|'));
  } catch (e) { out.push(`#FAIL ${f.save} ${e}`); }
}
`# files ${START}-${Math.min(END, M.files.length) - 1} of ${M.files.length}\n` + out.join('\n')
