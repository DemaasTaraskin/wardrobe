---
name: miro-board-export
description: Export every image from a Miro board as original-quality files, plus all text on the board (captions under images, group headers, sticky notes, frames), starting from a Miro share link — without access to the user's Miro account. Use this whenever the user shares a miro.com/app/board/... link and wants the pictures or text out of it, or says things like "выгрузи фото из миро", "скачай картинки с доски", "вытащи подписи с доски Miro", "забери всё с доски по ссылке", "export images from my Miro board", "download the photos from this Miro link", "get the captions/notes off the board" — even if they only mention one board among several or don't say "export".
---

# Miro Board Export

Gets two things out of a Miro board that the user shares by link: the **original image files**
and the **text on the board** (captions, group headers, stickers, frames), tied to the images
they describe. No Miro account, API token or paid plan is needed. Everything runs in the built-in
browser as an anonymous viewer of that one board.

Miro has no bulk image download on the free plan, and the board is drawn on a canvas, so neither
the page text nor screenshots give you the files or the text. What works: Miro streams every board
object over a WebSocket when the board loads, and serves each original file through a signed CDN
link to anyone who can view the board. The scripts in `scripts/` handle both.

## Privacy boundary: set it up first

Users often keep other, private boards in the same Miro account. The link to the one board is the
access boundary, so keep it tight:

- Ask for a board link with **Share → Anyone with the link → Can view**. This works on the free
  plan and is set per board, so other boards stay closed.
- Open it only in the **built-in browser** (`mcp__Claude_Browser__*`), where you're not signed in
  to Miro. Don't use Claude in Chrome for Miro: that is the user's real browser, signed in to their
  account, and would expose every board.
- Don't sign in, and don't open the dashboard or any other board. If the link shows a login wall
  ("This is a private board from … Sign up for free in order to access"), the board isn't shared
  publicly or the link was already switched off. Tell the user which setting to change; don't work
  around it.
- Once you've taken a screenshot, check the top bar shows **"Sign up for free"** and **"View only"**.
  That confirms you're an anonymous viewer.
- When you're done, remind the user to set the link back to **No access**.

## Workflow

### 1. Open the board with the capture hook in place

The hook has to be installed before Miro opens its WebSocket, which happens a few seconds after
page load. Objects that have already loaded are never sent again, even after a reconnect. So run
the hook in the same `browser_batch` as the navigation:

```
browser_batch:
  1. navigate → <board link>          (or preview_start with the url if the pane isn't open)
  2. javascript_tool → contents of scripts/ws_hook.js   (Read the file, pass it as `text`)
  3. computer wait 10
  4. computer screenshot               (board title, "View only" / "Sign up for free" visible)
```

If the pane is not open yet, open it with `preview_start {url}` first. Then do the
`navigate` + hook batch, because the first load in a new pane may be too fast to hook.

### 2. Decode the board

Read `scripts/extract_board.js` and run it with `javascript_tool`. It returns a summary:
- frames captured
- images placed and unique files, with an approximate total in MB
- headers, captions, linked captions and unmatched captions
- stickers and frames

Sanity check: `uniqueFiles` should roughly match what the zoomed-out screenshot shows. If
`capturedFrames` is tiny or `uniqueFiles` is 0, the hook was late. Repeat step 1. On very large
boards some objects may load only when the camera reaches them. If the counts look short, zoom and
pan across the board, then run the extract again.

### 3. Ask where to save — always, before downloading anything

Where the photos go is the user's call, and it's easy to get wrong: a few hundred MB of PNGs
dropped into a OneDrive, Dropbox, iCloud or Google Drive folder will start syncing to the cloud. Ask
with `AskUserQuestion` once you know the numbers, and make the same question the download
permission:

- State the facts: **N files**, source `r.miro.com` (Miro's CDN), about **X MB**, typical
  resolution (from `sampleFiles`).
- Suggest options that fit the working directory. Include a subfolder of the project and a folder
  **outside any cloud-synced directory**, for example `C:\Users\<user>\<board>-photos`. Let
  "Other" take a custom path.
- If the project folder sits inside a cloud-synced directory, say so in the question.
- Offer a **single test file first**. Users like to see quality before committing hundreds of MB.
- Also confirm where the text export (`miro_board.json`) should go. Default: the working directory.

If the user asks you to pause or change their cloud sync, explain that sync settings are system
settings they should change themselves, for example via the tray icon → Pause syncing. Offer the
outside-sync folder as the real fix, since pausing only postpones the upload.

### 4. Download originals in chunks

Signed links live about 15 minutes, so work in chunks of about 32 files:

1. Read `scripts/signed_urls.js`, set `START`/`END`, and run it with `javascript_tool`. It prints
   one line per file.
2. Save those lines to a list file in the scratchpad **with the Write tool**. Don't use a Bash
   heredoc: on Windows a command line tops out at about 32K characters, and 32 signed URLs exceed
   that, which fails with a confusing "unexpected EOF" error.
3. Run `python <skill>/scripts/download.py <list> "<dest>"`. Use `--limit 1` for the test file.
   The script skips files that already exist, flags expired links, and verifies each image with
   Pillow when it's installed.
4. For the test file, `Read` the image to confirm it's the real original, then report its
   resolution and size.
5. Repeat for the next chunk until `files_in_dest` equals `uniqueFiles`.

### 5. Save the text export

Run `JSON.stringify(window.__mbx.export, null, 1)` with `javascript_tool` and write the result to
`miro_board.json` in the agreed location. Structure:

```json
{
  "board": "...", "link": "...", "exported": "YYYY-MM-DD",
  "groups": ["header text", "..."],
  "stickers": ["sticky note text", "..."],
  "frames": [{"name": "Frame 24"}],
  "frame_children": {"<frame id>": ["file.png", "..."]},
  "unmatched_captions": ["..."],
  "items": [{"file": "IMG_1.png", "group": "header above it or null", "caption": "text under it or null"}]
}
```

`file` matches the saved filename. Then cross-check the export against the folder with a quick
Python count. Every `items[].file` and every `frame_children` file should exist on disk, and
vice versa.

### 6. Frames and anything that needs eyes

Children of frames have coordinates relative to the frame, so they are listed separately and not
assigned to groups. A frame with children is often a composed example, such as a sample outfit or
a moodboard. To see what's in it, open the **Frames** button in the bottom-right toolbar, click the
frame name, and take a screenshot. Or build a contact sheet from the downloaded files with Pillow
and `Read` it. If there are several frames with children, match `frame_children` ids to frame
names by comparing screenshots with the file lists.

Caption and group links are **inferred from layout**. A caption is taken as belonging to the image
directly above it, and a group as the nearest header above the image within its horizontal band.
That matched this user's boards, but other layouts differ. Before you rely on the links, spot-check
a few against a zoomed screenshot. If many captions come back unmatched, the captions probably sit
above or beside the images. Adjust the rule in `extract_board.js` rather than guessing by hand.
Leave `group: null` where nothing fits; that is more useful than a wrong group.

### 7. Report

Keep it short:
- **Files:** count and size, where they're saved, whether they're originals, and any failures.
- **Text:** how many groups, captions and stickers were found, and where the JSON is.
- **Loose ends:** items without a group, unmatched captions, and captions that repeat on several
  photos (could be duplicates or colour variants).
- **Link:** remind the user to set the link back to **No access**.

## Things that don't work (don't burn time on them)

- **`read_network_requests` for the inventory.** The tab keeps only the last ~500 requests, and
  board load produces more. The WebSocket capture is the reliable source.
- **The `…/files/preview` endpoint.** It returns a ~13 KB thumbnail.
- **`fetch('…/files/original')` without `?redirect=false`.** It redirects cross-origin and fails.
- **The accessibility "Explore board content" outline and Ctrl+F search.** Neither renders
  anything for anonymous viewers.
- **Reconnecting the socket (closing it) to re-trigger loading.** Miro only re-sends a handful of
  preloaded objects.
- **Miro comment threads (speech-bubble comments).** These are not part of this capture. If the
  board shows comment icons, tell the user they weren't exported.
