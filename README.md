# Todoku

**Todoku turns a web page into a short stack of cards that a screen reader user steps through with the arrow keys and Enter.**
It is a desktop app for Windows and macOS (Electron), built during Built with Claude: Japan 2026 (2026-11-02 to 2026-11-08) for theme 2, "Things that should reach everyone".
日本語の説明は、このページの後半にあります。

- **Who it is for:** blind and low-vision people who use a screen reader (NVDA on Windows, VoiceOver on macOS), and the supporters who set things up for them.
- **The problem:** web pages lay information out in two dimensions, and a screen reader user follows it by sound, one element at a time, so reaching the one thing they need usually takes time and effort. On the Japan Meteorological Agency's past-weather download page, for example, the links and buttons are images and table cells, and students who had to download data from it in a class needed a long time just to find them.
- **What changes:** each page becomes a deck of cards, one per thing to read or do ("新着情報を読む", "データを表示", "CSVダウンロード"). Up and Down Arrow choose a card, Enter reads it (or clicks the page's button or link), Esc goes back. Choosing a station, showing the data and saving the CSV become single steps in a row. Slideshows that switch by themselves (carousels) are read in full with numbers, and every link on a page is listed by where it is on the page (the real Tsukuba City top page: 157 links in 22 cards).

## Where Claude comes in

1. **Repairs a card the moment a site changes.** When a card no longer finds what it should read or click, the app sends Claude only the failing line and the page's text-free structure. Claude proposes a new CSS selector; the app tries it on the open page, keeps it only if it fits, and reads the card again ("ページが変わったので、読む場所を直しました。"). With the real Claude on Windows this took 12 to 17 seconds (2026-11-04). The fix stays on this computer, can be undone, and a supporter can write it into the config file to share it.
2. **Builds a deck for a page that has no config file.** From the same text-free structure, Claude proposes 4 to 8 cards. The app tests each one, makes the titles itself, and adds the main tables and sections, so the core cards are the same every time. With the real Claude on Windows: 14 to 35 seconds and 6 to 9 cards for the Meteorological Agency's warnings page (2026-11-04).
3. **Only the structure is sent.** No page text, URL, page title, link, name or form value goes to Claude: only element names, nesting and short ASCII names of ids, classes and roles. If any Japanese character is left in the request, nothing is sent.

Without an API key, everything except these Claude features works. To try it: `npm ci`, then `npm start` (see "Getting started" below).

## What it does

- Each web app (a learning site, a city website, ...) has a small config file that says, card by card, where to read and what to press.
- The app turns that config into a deck of cards. Up and Down Arrow move between cards, Enter or Space opens a card or reads the web app, Up and Down Arrow then read the result item by item (past the last item the app says "ここが最後です。", above the first "ここが一番上です。"), and Esc goes back. Tab stops only on the current card. The web app itself stays in a separate window behind the card screen and never takes the keyboard focus (except for a login, when the user asks for it).
- Items of a numbered list (`ol`) are read with their number first ("1 前の日の夜に、…"), following `start`, `reversed` and `value`; lists whose numbers are hidden with `list-style: none` are read without numbers.
- In a table row, when only the heading cell (the `th` cells, or the first cell if there is none) has text and every other cell is empty, the row is read as "{name} なし", so an empty row is not mistaken for a row that could not be read.
- When a card is selected, its description (the config's `description`) is read after the title (`aria-describedby`), as on the first screen.
- `list` cards read every matching item with numbers, so content hidden in carousels or long pages becomes "4 items. Item 1: ...". Text in images is read from their `alt` text and `aria-label`, and slides that a carousel hides with `aria-hidden` are still read, because the person asked for them.
- `click` cards ask first: Enter shows a "「{title}」をクリックする" button and puts the focus on it, so a second Enter clicks; "「{title}」をクリックします。" is read as the button's description. After the card's button is pressed, the app says "「{title}」をクリックしました。"; "「{title}」をクリックしています。" is said only when it takes longer than 0.5 seconds. On the screen and in announcements, "押す" (press) is used only for keys and buttons; what a click card does on the page is called "クリック" (click), and the place it acts on is called "ボタンやリンク" (button or link).
- Tables: a wide table that the page draws as two tables side by side (names and values) is read row by row with both halves joined (`joinWith`). When a table groups its rows under heading rows (for example one heading row per area and the rows for "特別警報", "警報" and "注意報" under it), each group is read as one item ("北部 特別警報 なし、警報 なし、注意報 強風注意報、雷注意報"), and a one-cell line under the table's title, such as the update time, is read at the start of the first item.
- Inside an app's deck the window title is "Todoku - {deck name}", so the deck can be told from the window title too; it goes back to "Todoku" on the first screen.
- When a web app changes its screen and a config line no longer matches, the app reports only which line fails. With an API key, the repair happens on the spot (see "Automatic repair on the user's side"); a supporter can then write the fix into the config file to distribute it.
- When a page is still being written (for example a chat reply that appears bit by bit), the card waits until it is finished; see "Pages that are still being written".
- Screen readers: on Windows 11 the cards were used with NVDA 2026.3 throughout development, and checked by hand with PC-Talker Neo (moving between cards, reading a list card, the result announcement) on 2026-11-04. On macOS they are meant for VoiceOver; the first card explains that the arrow keys reach the cards when VoiceOver's Quick Nav is off.
- Japanese input: while text is being converted in the search box, Enter only confirms the conversion and does not jump to a card (checked by hand on Windows 11 on 2026-11-04).

## Getting started (Windows)

- Requirements: Windows 10/11 (x64 or Arm64), Git, Node.js 22.12 or later (tested with Node 26.13 on Windows 11 Arm64).
- Get the code: `git clone <this repository's URL>`, then `cd` into the new folder.
- In the repository folder, install dependencies: `npm ci`
  - `npm ci` does not download the Electron binary. The first `npm start` (or `npm run smoke`) does, printing "Downloading Electron binary..." (about 120 MB), so the first start takes longer.
  - Behind an HTTP proxy, that download may fail with "fetch failed". Setting `NODE_USE_ENV_PROXY=1` (Node 24.5 or later) together with `HTTPS_PROXY` lets the download use the proxy.
  - `npm ci` reports moderate vulnerabilities and a deprecated package, and npm 11 also warns about install scripts (from `electron-winstaller`). They are all in the packaging tool (`electron-builder` and the packages it uses), which is used only to build the installers and is not part of the app.
- Start the app: `npm start`
  - The first screen ("Todoku") opens. Its cards are the app's introduction, display settings, search, the folder cards, one card per web app that is not in a folder, "フォルダを作る" and "新しいページからカードを作る".
  - Results are announced through a `role="status"` live region (errors through `role="alert"`), and the result items are put inside the card so they can be read again with the arrow keys.
  - The app keeps its data (generated decks in `generated/`, local repairs in `repairs/`, config backups in `config-backups/`, display settings in `settings.json`, folders, names and notes in `bookmarks.json`, and `log.txt`) in `%APPDATA%\Todoku` (measured with `npm start` on Windows 11 on 2026-11-04). The folder used by the installer has not been checked yet.
- Run the tests:
  - `npm test` runs the unit tests with Node's built-in test runner. It does not need the Electron binary. 7 tests are reported as skipped: they are the scripts that run only inside Electron or only on request (`npm run smoke`, `npm run voiceover:check` and the others below).
  - `npm run smoke` runs the end-to-end checks inside Electron against the bundled practice pages in `test/fixtures/` (no network access).
  - `npm run ui:repair` runs the supporter's check-and-repair flow end to end on the real main process, with a fake Claude and a practice page whose structure has changed: it presses "設定ファイルを確認する（支援者向け）", accepts the first proposal and rejects the second, and checks that only the accepted line is written to the config file (in a temporary folder) and that one backup is made. Set `UI_REPAIR_REAL=1` (with an API key) to ask the real Claude instead; then it only prints the proposals.
  - `npm run smoke`, `npm run ui:repair` and `npm run real:tsukuba` keep their windows hidden and never take the keyboard focus from the app in front (on macOS they also stay out of the Dock), so they are safe to run while someone is typing. Add `-- --show-windows` to show the windows (for example, to watch the `ui:repair` flow).
  - `npm run smoke:windows` runs the same smoke checks with the windows shown, so the focus checks also cover the real window manager. Its windows come to the front, so run it only when nobody is using the computer.
- Before recording a demo: close Todoku and run `npm run demo:reset`. It moves the generated decks (`generated/`), the local repairs (`repairs/`), the display settings (`settings.json`) and the folders, names and notes (`bookmarks.json`) out of the app's user data folders (`Todoku`, used by `npm start` and by the built app; and `hackathon2026`, the folder that earlier versions used) into `reset-backup/<date-time>/` there, without deleting anything, and prints what it moved. `npm run demo:reset -- --restore` puts the latest backup back (it never overwrites files that exist again).
- Build Windows installers: `npm run dist:win`
  - Produces an installer (`dist/Todoku Setup 1.0.0.exe`) and a portable build (`dist/Todoku 1.0.0.exe`), each containing both x64 and Arm64.
  - The builds are not code-signed, so Windows SmartScreen may show an "unknown publisher" warning.
  - Config files inside the packaged app are read-only. To let the app write repaired selectors, keep your config files in the local folder (`CARDS_LOCAL_DIR`) or run from a working copy with `npm start`.

## Getting started (macOS)

- Requirements: macOS on Apple silicon, Git, Node.js 22.12 or later (tested with Node 22.19).
- `git clone <this repository's URL>` and `cd` into the new folder. In the repository folder, `npm ci`, then `npm start`. As on Windows, the first `npm start` downloads the Electron binary. `npm test` and `npm run smoke` work the same way as on Windows.
- Closing the Todoku window quits the app on macOS too (it does not stay in the Dock without a window).
- `npm run voiceover:check` checks what VoiceOver actually reads. It starts VoiceOver through AppleScript, opens Todoku (with a temporary user data folder) and moves through the cards with the arrow keys, recording VoiceOver's last spoken phrase: the card titles on the first screen, the count and the items of a list card on the practice city page in `test/fixtures/`, and the result announced through `role="status"`. Real sites are not read. It needs "Allow VoiceOver to be controlled with AppleScript" in VoiceOver Utility and Quick Nav turned off; it shows a window and VoiceOver speaks, so run it only when nobody is using the Mac. VoiceOver is always stopped at the end (unless it was already running before), even after a failure, a 5-minute timeout or Ctrl+C.
- Where the app keeps its data (the same files as on Windows): `npm start` and the app built with `npm run dist:mac` both use `~/Library/Application Support/Todoku` (the folder is named after `productName` in `package.json`; measured on macOS on 2026-11-04). The built app's menu is named "Todoku"; with `npm start` the menu is still named "Electron", because the development binary keeps its own name. On Windows, see "Getting started (Windows)".
- If the Electron binary download fails behind a proxy, download `electron-v<version>-darwin-arm64.zip` and `SHASUMS256.txt` from the Electron releases page, check the SHA-256, extract the zip into `node_modules/electron/dist`, and write `Electron.app/Contents/MacOS/Electron` into `node_modules/electron/path.txt`.
- Build a macOS disk image: `npm run dist:mac` produces `dist/Todoku-1.0.0-arm64.dmg` (Apple silicon). It is not signed or notarized, so macOS warns that the developer cannot be verified; open it from the context menu (Open) the first time.
  - Behind a proxy, point `ELECTRON_CACHE` to a folder that already holds the Electron zip and `SHASUMS256.txt`. The same `ELECTRON_CACHE` also works for the first `npm start`.

## Configuration (environment variables)

- `CARDS_LOCAL_DIR` (optional): a folder of extra config files (`*.json`) that are loaded after the bundled `cards/`. Use it for sites whose configs you do not want to publish. A config whose `id` duplicates one already loaded is skipped and reported.
- `CARDS_ANTHROPIC_API_KEY` (optional): the Anthropic API key used to ask Claude for repaired selectors and for new decks. Without it, the app says it cannot repair or make cards; everything else works. The app deliberately does not read `ANTHROPIC_API_KEY`, so that the key used by the app stays separate from other tools on the same machine.
- `TODOKU_DUMP_DIR` (optional, for developers): each time a deck is made, the app writes three files there: `<id>-a-structure.txt` (the text-free structure sent to Claude), `<id>-b-proposals.json` (Claude's answer as returned) and `<id>-c-deck.json` (the deck after the app's own guards, with card titles, and every proposal that was dropped with a short reason). Page text (the titles) appears only in the third file, so only the first two may be shared.
- `TODOKU_YOUTUBE_API_KEY` (optional): a YouTube Data API v3 key, used only by the YouTube cards (below). The key stays in the main process: it is not passed to the card screen and is not written to files or logs. Without it, the YouTube cards say "YouTube の API キーが設定されていません。"; everything else works.
- `CARDS_REPAIR_MODEL` (optional): the Claude model used for every Claude call (repairs and new decks). Default: `claude-opus-5-5`.
- `https_proxy` / `HTTPS_PROXY` (optional): passed to Electron as `--proxy-server`, so the app can reach outside pages from a network that needs a proxy. `no_proxy` / `NO_PROXY` (optional) is passed as `--proxy-bypass-list`. Without them, the app uses no proxy switches and follows the system proxy settings. At startup the app tries to reach the proxy it would use (from these variables or from the system settings, 2-second timeout); if it cannot (for example, off campus while the system proxy still points to the campus proxy), it connects directly inside the app only, without changing the system settings, and writes one line about it to the terminal (when started with `npm start`) and to `log.txt` in the app's user data folder. Each line starts with the computer's local time and its offset from UTC (for example `2026-11-04T09:30:05.123+09:00`).

## Downloads

- When a click card starts a download in the web app window, the app saves the file to the user's Downloads folder under its original name (adding " (1)", " (2)", ... if the name is taken), or under the card's `saveAs` name if the config gives one, without a save dialog, and announces "「file name」をダウンロードのフォルダに保存しました。" (or that it could not be saved).

## What is sent to Claude

- The app collects only the page structure: element names and nesting, plus id, class, role, aria-* and data-* values, `type` and `name`. All page text, links, image sources, `title`, `alt` and form values are removed, and `script`, `style`, `svg` and `iframe` are skipped; elements that contain text are only marked "(has text)". Attributes whose value is human-readable text (such as `aria-label`) are kept by name only.
- A value is kept only if it is a short plain-ASCII name (letters, digits, `_`, `:` and `-`, up to 40 characters). Values that may identify a person or a record are dropped even then: anything with 5 or more digits in a row (such as a student-number-like id), GUIDs, and names of 12 or more characters that mix letters and digits. An id or class that fails these rules is left out; other attributes keep only their name. This applies to `role` too.
- Before sending, the app checks the whole request text (`looksTextFree`): if it contains any Japanese character (hiragana, katakana, kanji, full-width characters or Japanese punctuation), nothing is sent. This is done for repairs and for new decks. The check cannot recognize English words that happen to be valid names, so an English page's id or class names can still reach Claude as names.
- For a repair, Claude also receives the failing line (location in the config, the card id if it is plain ASCII, action, and the old selector with any non-ASCII text replaced by "…") and returns a proposed selector with a short reason (structured output). Card titles are not sent, because the titles of generated decks come from the page's headings.
- If the check fails during a repair, the card says it could not be repaired. Selectors that the app makes itself never use ids that are not plain ASCII names.
- A supporter decides what is distributed: a fix is written into a config file only from the supporter card (see below), and the previous file is backed up to the app's user data folder (`config-backups`). Supporters can also check every card of an app at once: inside each app's deck, the first card (the one that introduces the app) has a "設定ファイルを確認する（支援者向け）" button, placed before the source button. It opens a one-card deck that lists the lines that no longer match and, with an API key, Claude's proposal for each line (the current selector, the proposed one with how many places it matches on the page, and the reason, each as one plain line such as "いまのセレクタ: …"), one at a time, with "…の直しを使う（設定ファイルに書く）" (write it into the config file, keeping the previous version in `config-backups`) and "…の直しを使わない" buttons. When writing takes longer than 0.5 seconds, the app says "書いています。" once. After a decision, focus moves to that proposal's line, which now says the result ("…: この直しを使いました。設定ファイルに書き、前の版はバックアップとして残しました。"); Down Arrow then reads the next proposal. The card also says that a rejected line is still repaired on the spot on the user's side when an API key is set. Without an API key, it only lists the lines that do not match. What is sent to Claude follows the same rules as above.

## Automatic repair on the user's side

- Trigger: a `read`, `list` or `click` card finds nothing on the page ("cannot read"; an empty list found through `container` is "0 items", not a failure). Login screens, broken config syntax and pages that fail to open are not repaired.
- The app collects the structure of the page that is already open (no reload), checks that it contains no page text, and sends Claude only the failing line and that structure. It waits at most 45 seconds; while waiting, the usual "reading" progress messages say that the card is being repaired.
- The proposal is tried on the current page and adopted only if it looks right: `read` matches at least one element with some text, `list` matches at least one item, `click` matches exactly one element.
- After adopting, a `read` / `list` card is read again and the screen reader hears "ページが変わったので、読む場所を直しました。" once. A `click` card is not pressed again; the user is told that it was fixed and decides whether to press it.
- The fix applies only on this computer. The bundled `cards/*.json` are not changed. Each app gets an override file in the app's user data folder (`repairs/<app id>.json`) with the card, the original and the new selector, Claude's reason and the time, so the fix still works after a restart. If a newer config file changes that selector, the override is ignored.
- Undo: the repaired card has a "直す前に戻す" button. Supporters can open the "自動で直した場所（支援者向け）" card at the end of the app's cards to see every automatic fix, write one into the config file (the same way as accepted proposals, with a backup in `config-backups`), or undo it.
- After "直す前に戻す", focus moves to the first item inside the same card, so one Esc returns to the card and does not leave the deck.
- Without an API key, or when Claude fails, times out or the proposal does not look right, the card says "cannot read" as before and ends with one more sentence with a short reason, e.g. "自動で直すこともできませんでした（Claude の API キーがありません）。" (other reasons: "時間内に終わりませんでした", "確かな直しの候補がありませんでした", "Claude が直しの候補を作れませんでした"). The click card adds the same sentence to its "could not press" message.

## Cards for a page without a config file

- The first screen ("Todoku") has a card "新しいページからカードを作る" (make cards from a new page). Pressing Enter or Space on it moves to a labeled URL field ("ページのURL（http か https で始まるもの）"). Only `http://` and `https://` addresses are accepted. Enter in the field, or the "作り始める" button, starts.
- The app opens the page, waits until the number of elements, the amount of text and the loaded resources stop changing (at most 15 seconds), and collects the same text-free structure as for repairs (`looksTextFree` must pass). Claude receives only that structure: no page text, no URL, no page title. The structure is capped at 2,500 elements by `structure.js` and at 120,000 characters before sending; if it is cut, Claude is told so.
- Claude returns 4 to 8 cards in the config-file shape (structured output with zod): `role` (heading, main, list, notice, table, menu, search, button, link, other), `action` (`read` / `list` / `click`), `selector`, `container` (list cards only), `titleSelector` (the element whose text should become the card title) and a one-sentence reason.
- Card titles are made on this computer, never by Claude: the app uses the `titleSelector` element only when it belongs to the card's place (inside it, or the heading just before it), and otherwise the heading, `aria-labelledby`, landmark label or first short text of the place. A `click` card is titled with the name of the element to press, made clearer when it is one word ("市町村選択" becomes "市町村を選ぶ", a place name becomes "地域を選ぶ（…）", "検索" becomes "サイト内を検索する"); a button that switches what is shown (a tab, `aria-controls`, `aria-pressed` or `aria-selected`, or one of three or more buttons in a row) becomes "表を替える（…）" when it switches a table, otherwise "表示を替える（…）". Long titles are cut at a word boundary. The deck name is the page's `<title>` without the site name part, also used only on this computer.
- Each proposed card is tried on the page, and dropped if it does not fit: `read` must match an element with text, `list` at least one item, `click` exactly one element. The app also drops cards it cannot title, `click` cards whose element has no name, cards whose content is a single word or just a heading line, breadcrumbs, and duplicates; a date line ("最終更新日：…") or a single generic word ("リンク", "詳細", "もっと見る") is never used as a title; a table of contents becomes one card "目次を読む". At most 8 of Claude's cards are kept.
- Guards that do not depend on Claude: the first table and the largest table of the main area (3 or more rows each; the largest list only when there is no table) always get a card, and so do up to 3 more tables that have their own title (a `caption` or a one-cell title row at the top, even with fewer rows), even when Claude did not propose them; lists or tables whose items are only links or buttons (menus, pickers) are never chosen. Tables are read one card per table: a card of Claude's that mostly reads tables is split into one list card per table, titled with the table's own title; a card that reads only the title part of a split table becomes the card for that table; a list of one table's rows takes that table's title; and a list made of table cells, or of rows from two tables, is dropped because those tables get their own cards. Next to a table, a row of three or more buttons that switch it gets a "表を替える（…）" card when Claude did not propose one. Cards whose place is not displayed (for example a description that stays folded until "▼ 説明を表示する" is pressed) are not made; rotating banners and folded link menus still are. Titles that are only a date and time ("…更新") are not used, and marks at the start of a title (▼, ■, ●, ※ and the like) are removed, because screen readers read them aloud. Up to 10 cards are added, one per heading section of the main text (split at the top two heading levels) (`until` reads from the heading to the next heading; sections under 40 characters are skipped; a card of Claude's that reads the whole main text, containing two or more of these headings, is replaced by the section cards; a line that only jumps back inside the page, such as "目次に戻る", is not read); and the cards are ordered by their position on the page, except that page parts (a card that holds only the update date, the page number, print or text-size controls), contact ("お問い合わせ"), site menus and site-name cards (such as "〇〇市役所"), and search are put at the end, in that order. A menu card is titled "〇〇のメニュー" from the menu's `aria-label`, the heading (or `dt`) just before it, or its first item; "地域のメニュー" when most items are place names, otherwise "サイトのメニュー". Headings that the page's table of contents points to (by `id` or an old-style `a[name]`) always start a section, even a short one, and a section that contains a list is kept as a section instead of being replaced by a card for that list. Claude's proposals vary from run to run (the model, `claude-opus-5-5`, does not accept a `temperature` setting), so these guards keep the deck the same: in the smoke test, ten different shapes of proposals for a made-up weather warning page all give the same four core cards and 6 to 8 cards, and the 11 sets of proposals Claude returned for the real weather warning page give the same core cards and 6 to 7 cards on saved copies of that page (the copies are not in this repository).
- The remaining cards are saved as a new config file in the app's user data folder (`generated/<id>.json`) and appear on the first screen at the next start too. While Claude works, the usual progress messages say how many seconds have passed. The whole process times out after 90 seconds. When done, the app opens the new deck and announces once "「{name}」のカードを{N}枚作りました。"; on failure it announces one sentence with the reason and shows the URL field again.
- The first card of a generated deck has two extra buttons: "設定ファイルとして書き出す（支援者向け）" writes the deck as `todoku-<id>.json` into the Downloads folder, so a supporter can check it and distribute it as a regular config file; "このアプリのカードを消す" deletes the deck and its local repairs.
- The first screen is now always shown, even when there is only one config, because it holds this entry point.

## Pages that are still being written

- While the element a card reads, or an element around or inside it, has `aria-busy="true"` (for example a chat reply that is being written), the card waits until it is removed, up to its usual waiting time (8 seconds).
- If it is still being written after that, the card reads what is there and says so: "「{title}」を読みました。まだ書いている途中です。", with one more item in the card: "まだ書いている途中でした。ここまでを読みました。もう一度読むと、続きが読めます。"
- Pages that do not mark this with `aria-busy` are read as they are at that moment.

## Display settings and search

- The second card on the first screen is "表示設定" (display settings), the same three settings as the shared card-page guide of the course materials. Normally it shows one button, "表示設定を開く"; Enter or Space opens and closes the settings. Readability: "標準" / "ゆったり" (wider letter, word and line spacing, one column). "1列リフロー表示" on or off (item headings and contents in one column, no maximum width). Colors: "標準（配色変更なし）" / "高コントラスト（白地）" / "高コントラスト（黒地）". "表示設定を標準に戻す" resets the three.
- Each change is announced once in one sentence, e.g. "配色を「高コントラスト（黒地）」にしました。", and the button text itself says the state ("、選択中" or "1列リフロー表示: 有効"). With NVDA, a selected button is read with both "押されています" (the toggle state) and "選択中"; the text is kept for screen readers that do not read toggle states.
- Text size: Ctrl (macOS: Command) with plus, minus or 0. The app handles these keys itself because the window has no menu, and announces the new size once ("文字の大きさを110%にしました。"). "表示設定を標準に戻す" does not change the text size.
- The settings and the text size are saved in the app's user data folder (`settings.json`) and applied before the cards are built at the next start. Unknown values fall back to the standard. When the OS forces colors (Windows High Contrast), the OS colors win.
- Contrast: text at least 7:1 and lines at least 3:1 in all three color schemes, including focused items and selected buttons. `test/settings.test.js` reads the colors from `style.css`, measures every pair, and checks the minimum written at the top of `index.html`.
- The third card, "カードを探す", searches the titles and descriptions of the cards of all apps, and also the app names and the display names and notes the user gave (see "Folders, names and notes"). Results appear right after it, one card per app, headed with the app name and the count; apps without results get no card. The total is announced once after typing stops ("3件見つかりました。", or "見つかりませんでした。別の言い方でお試しください。"). Esc in the field returns to the search card, and Down Arrow moves to the first result card (Enter in the field also jumps there). Each "「{title}」へ移る" button opens that app's deck on that card; Esc comes back to the result card. Matching ignores full/half width, upper/lower case and hiragana/katakana; spaces mean "all of these words".

## Links on the page, the original page, and the default browser

- Every app deck (from a config file or made by Claude) ends with a card "このページのリンク" (links on this page). Enter reads the links of the app's page one by one, by their link text (or `aria-label`, or the `alt` of an image inside the link). Only `http`/`https` links are listed; links to a place on the same page (`#...`), links to the page itself, links without a name, and duplicates (the same address, ignoring `#...`) are left out. The link text is read on this computer only; nothing new is sent to Claude.
- When the links are in more than one place on the page, they open as a deck with one card per place, for example "本文（リンク4件）", "トピックス（リンク17件）", "メニュー（リンク47件）", "フッター（リンク7件）" and "そのほか（リンク5件）". Places are the page's landmarks (`main`, `nav`, `header`, `footer`, `aside`, `role="search"`, named `section` and `role="region"`, with or without `role`), and inside `main` the h2/h3 sections. A place is named by its `aria-label`, `aria-labelledby` or first heading, otherwise "本文", "メニュー", "ページの上", "フッター" and so on. The main content comes first; language switches, "スマートフォン版" and similar page tools go to "そのほか" at the end. Every link is in exactly one card, so the counts add up to the total (on the real Tsukuba City top page: 157 links in 22 cards, checked on macOS on 2026-11-06). The grouping is done on this computer; nothing is sent to Claude.
- Enter on a link: if Todoku already has a deck for that address (a config file or a deck Claude made, matched by the deck's `url` or a card's `path`), the app opens that deck (on that card). Otherwise it asks first: "このページは、まだ Todoku で読めるようになっていません。これから Claude がカードを作ります。90秒ほどかかります。", with three buttons: "カードを作って開く" (make cards and open them; the same flow as "新しいページからカードを作る"), "既定のブラウザで開く" (open in the default browser) and "やめる" (cancel). Esc returns to the same link. The card's description says this once ("まだ読めないページは、開く前に確認します。"), so it is not repeated on every link.
- P and B first say what will happen and how to come back ("元のページを表示します。元のページでEscキーを押すと、Todoku に戻ります。"), wait about a second, and only then bring the other window to the front, because Todoku's announcements are not heard while another window is in front. Links whose text is only digits or one or two characters (a calendar day such as "6") are read by their `aria-label` or `title`, or with the place in front ("イベント情報：6").
- P key, or the "元のページを表示する" button on the app's first card: shows the original web page as it is, in its own window in front (for example to show how complex the Japan Meteorological Agency pages look). Esc in that window returns to Todoku, and so does closing that window. If the page was not opened yet, it is opened first.
- B key, or the "いまのページを既定のブラウザで開く" button on the app's first card: opens the current page of the app (the page the web app window is on, or the config's `url`) in the default browser, and says so. Only `http`/`https` pages are opened. The keys are the same on Windows and macOS, work on a card or an item (not in a text field), and do nothing on the first screen except saying "このキーは、アプリのカードを開いているときに使えます。". The two buttons carry `aria-keyshortcuts`.

## Folders, names and notes on the first screen

- The first screen can be used like bookmarks. The "フォルダを作る" card makes a folder: Enter moves to the name field, and Enter in the field makes it ("「天気」フォルダを作りました。"). Folder cards ("天気（フォルダ）") come before the page cards that are not in a folder; Enter on a folder card opens the folder. Its first card renames the folder or deletes it (the pages inside go back to the first screen, "…中のページのカード1件は、最初のページに戻しました。").
- Every app deck ends with a card "名前・メモ・フォルダ": a display name, a note, and one button per folder ("「天気」フォルダに入れる", "「天気」フォルダから出す"). With a display name, the page card is read by that name, and its description starts with the original name once, then the note. Every change is announced once ("「よく見るアプリ」を「天気」フォルダに入れました。"). No new keys: everything is done with the fields and buttons in the cards.
- "カードを探す" also searches app names, display names and notes; a match adds a "「{name}」のカードを開く" button.
- New decks (from a URL or from a link) are added to the first screen outside any folder. All of this is saved in `bookmarks.json` in the app's user data folder; if that file is broken, the app starts with no folders. `npm run demo:reset` moves it aside with the other saved data.

## YouTube cards

- `cards/youtube.json` ("YouTube の動画") searches YouTube and plays a video, without opening youtube.com in a window. The list comes from the official YouTube Data API v3 (`search.list`, then `videos.list` for the length), and each video is read as one item: title, length, date published and channel name. Enter on an item moves to the player card and plays it in the official embedded player (`youtube-nocookie.com`), shown inside the card screen at 640×360 with nothing drawn over it. The buttons (play, pause, back 10 seconds, forward 10 seconds, volume up and down) are below the player, and the focus stays on these buttons, never inside the player, so that a screen reader does not get lost in it. Volume changes are announced with the new level, e.g. "音量を60%にしました。". Playback starts only after the player is loaded and more than half of it is visible on the screen.
- Search words are sent to YouTube (Google). Todoku does not save them, and does not save the results: every search asks the API again. The first card of the YouTube deck says so ("検索の言葉は YouTube（Google）に送られます。Todoku は保存しません。") and has two buttons that open the YouTube Terms of Service (https://www.youtube.com/t/terms) and the Google Privacy Policy (https://policies.google.com/privacy) in the default browser. By using the YouTube cards, you agree to the YouTube Terms of Service.
- Only the API and the embedded player are used; the app does not read or operate youtube.com pages. The embedded player is told who embeds it: requests to `www.youtube-nocookie.com` carry the app id (`build.appId` in `package.json`) as the `Referer`, because the card screen is a local file and would otherwise send none, and the player then refuses to play. Links inside the player that open a new window ("Watch on YouTube") open in the default browser.
- A YouTube config has `"kind": "youtube"` and no `url`. Card actions: `youtube-search` (a search box), `youtube-channel` (the newest videos of one channel, with `channelId`, the 24-character id starting with `UC`) and `youtube-player` (the player card; exactly one is needed). `maxResults` (1 to 50, default 10) is optional for the first two.

## Config file format (short)

- `id`, `name`, optional `description` (a description of the app, such as a source credit; read as the last item of the app's first card; keep URLs out of it, because screen readers read them almost character by character), optional `sourceUrl` (the `http(s)://` page of the source; the app's first card gets a "出典のページを開く" button that opens it in the default browser), `url` (`http(s)://...` or `fixture:<name>.html` for the practice pages), optional `login` (`selector` that indicates a login is needed, and `path` of the login page), and `cards`.
- Each card: `id`, `title`, `action` (`read` one element, `list` all matching items with numbers, `click`), `selector`, optional `path` (a page on the same site), `description`, for `click` cards only, `saveAs` (the file name for a download the card starts: `{date}` becomes the save date as yyyy-mm-dd, `{n}` the first unused number from 1; the original extension is added when the name has none), and, for `list` cards only, `container` (the selector of the element that holds the items: if it matches but no item does, the card says "0 items"; if it does not match either, the card says it cannot read. Without `container`, no items means "cannot read", because an empty list and a changed screen look the same). Also for `list` cards only, `dateSelector` (the date element inside each item: when the page shows only the day, the app reads the year, month and day written in that element's `datetime` or `id`, such as `2026-11-06` or `calendar_list_2026_11_6`, says the date as "11月6日", and waits until such dated items appear; when the date element is outside the item, for example one row per day with several events, the app looks for it in the item's row and puts the date and the weekday before each item), `tagSelector` (category labels inside each item, read after the title in brackets), `skipItemsMatching` (a regular expression: an item whose text matches is not read and is not counted, e.g. `"PR|広告"` to leave advertisements out of a news list; links whose text matches are also left out of "このページのリンク" for decks from config files), `undatedLabel` (a short label such as `"固定の記事"`: when other items start with a date, an item that does not is read with "固定の記事、" in front, so the user knows it has no date; a leading decoration like "＼Hot!／" is read without the backslash and slash in every list), `joinWith` (the rows of a second table: item n is read with row n of this table joined after it, for a wide table drawn as two tables), and `itemTarget` (what to read when the user presses Enter on one item of the list: `label`, the name used in announcements such as "返事", and at least one of `closest` (go up from the item to this element), `next` (then the first following sibling that matches) and `find` (then this element inside it). The result opens as one card, "3件目の返事", and Esc twice returns to the same item. When the list is read, the app keeps a short hash of each item (not the text itself); when an item is chosen, it finds the item with the same hash on the current page, so the choice still works after new messages are added above. If that item is gone, the app says "「{title}」を読んだ後に画面が変わりました。もう一度「{title}」を読んでください。". Example: in the practice chat, `{ "label": "返事", "closest": "li.turn", "next": "li.ai", "find": ".body" }` reads the reply to the selected question). For `read` cards only, `until` (a selector: the card reads the matched element and the sibling elements after it, up to the first one that matches `until`; cards that Claude makes for each section of the main text use it to read from a heading to the next heading).

## Bundled examples

- `cards/moodle-demo.json`: the public Moodle demo site (https://school.moodledemo.net/). The demo is shared by many people and is reset every hour; the app only opens it when a person chooses a card.
- `cards/tsukuba-city.json`: the official website of Tsukuba City (https://www.city.tsukuba.lg.jp/), a real city site. Cards read the emergency information, the new pages, the notices, this month's events (from the event calendar page), every slide of the slideshow at the top ("スライドショーのお知らせを全部読む") and of the pickup slideshow (the copies a carousel makes for looping are skipped), and the life-situation links. There is no card for the site search: the search box is an embedded search service, and Todoku cards cannot type text yet. The app's first card says "出典：つくば市公式ウェブサイト。" and has a button that opens the official site (`sourceUrl`). The app opens the city's pages in its own window and reads the text as it is; it does not change the pages and does not put them in a frame. `npm run real:tsukuba` checks every card and the automatic repair (with a fake model and `test/tsukuba-city-old-line-for-test.json`, a copy with one deliberately outdated selector) against the real site; it loads the site three times, so run it by hand, not in a loop.
- `cards/jma-forecast.json`, `cards/jma-daily.json`, `cards/jma-obsdl.json`: pages of the Japan Meteorological Agency (forecast for Tokyo, daily past weather data, and the past weather data download form, with click cards for each step of the form).
- `cards/ntut-top.json`, `cards/ntut-kyosei.json`, `cards/ntut-magazine.json`: the public websites of Tsukuba University of Technology (the university, one faculty, and the web magazine). Some kinds of notices are left out of the lists (`skipItemsMatching`), and links whose text contains the same words are left out of "このページのリンク" too (only for decks from config files, not for decks Claude made).
- `cards/practice-city.json` and `test/fixtures/city-top.html`: a made-up city website ("Midori City") with an auto-rotating carousel and other common barriers. It is fictional and not based on any real city's site.
- `cards/practice-chat.json` and `test/fixtures/chat.html`: a made-up chat screen ("ことのはチャット") with 12 rounds of questions and replies, a list of past chats, and a last reply that is written bit by bit. Cards read the last reply, all of your questions (Enter on one question reads its reply), every message in order (Up and Down Arrow move between messages), the list of past chats, and the code blocks in the last reply.
- `cards/practice-course.json` and `test/fixtures/course-before.html` / `course-after.html`: a made-up course page before and after a layout change, used to show the repair flow.
- All names in the practice pages are fictional.

## How Claude is used

- In the app: Claude (default `claude-opus-5-5`) proposes repaired selectors from the page structure, as described above.
- In the app: Claude also proposes a whole deck of cards for a page that has no config file, from the same text-free structure.
- Not by Claude: reading the page, making card titles, testing proposals, and deciding what is kept are all done by the app on this computer.
- In development: the app was built with Claude Code. One Claude Code session on Windows wrote most of the app and tested it with NVDA; another on macOS reviewed the changes, wrote this README and the private local configs, and checked names and personal data before each push.

## Tests

- `npm test`: 159 tests, 152 passed, 7 skipped (the Electron-only scripts), 0 failed.
- `npm run smoke`: 257 checks, 257 passed, against the practice pages (and a local test server that never answers) only.
- `npm run real:tsukuba`: 13 checks, 13 passed, against the real Tsukuba City site.
- `npm run smoke:windows`: the same checks with the windows shown, plus one that checks the real focus (258 checks, 258 passed).
- All four were measured on macOS on 2026-11-06. On 2026-11-04 (with fewer tests), `npm run smoke` was also measured on a fresh clone of this repository, following "Getting started (macOS)", and both `npm test` and `npm run smoke` on a fresh clone on Windows 11, following "Getting started (Windows)". `npm run real:tsukuba` loads the real site, so it is run by hand only.

## Future

- A browser for people who use the web by voice: the goal is that any page can be reached, not only the sites someone has written a config file for. Making cards for a new page and repairing them on the spot are the first steps.
- Sharing decks between users (not built yet). When someone opens a page that has no config file, Todoku would make the deck on the spot and upload its config to a server, so the next person who opens the same page gets cards right away. Only structural information would be uploaded: selectors, what each card does (read, list or click) and the order of the cards. Card titles are page text, so they would not be uploaded either; the receiving app would make the titles again on its own machine from the page's headings. The same rule would apply to every page, whether or not it needs a login. Shared configs would go through the same human check as today, where a supporter looks at a config before it is handed out.
- Going back and forth through a conversation in a chat screen. We tried this only on a made-up chat screen (`test/fixtures/chat.html`). We have not used it on real chat services, because their terms of use restrict automated access to their screens, with no exception written for assistive tools.

## Third-party software

| Package | Version | License | Used for |
|---|---|---|---|
| electron | 45.2.1 | MIT | runtime (development and packaging) |
| electron-builder | 26.18.0 | MIT | packaging only |
| @anthropic-ai/sdk | 1.3.0 | Apache-2.0 | calling Claude |
| zod | 4.6.7 | MIT | schema for structured output |
| @electron/asar | 4.3.1 | MIT | packaging only (override) |
| rimraf | 5.0.10 | ISC | packaging only (override) |
| glob | 13.0.6 | BlueOak-1.0.0 | packaging only (override) |

Licenses were read from each package's `package.json` in `node_modules`.

---

## 日本語

**Todoku（とどく）は、Web ページを、スクリーンリーダーのユーザーが上下の矢印キーと Enter キーでたどれる、カードの短い束にします。**
Windows と macOS のデスクトップアプリ（Electron）です。
Built with Claude: Japan 2026（2026年11月2日〜8日）の期間中に、テーマ2「本来、誰にでも届くべきもの」に向けて作りました。

- **だれのためか:** スクリーンリーダー（Windows の NVDA、macOS の VoiceOver）を使う、視覚に障害のある方と、その方のために設定を整える支援者です。
- **困っていること:** Web ページは、情報を2次元のレイアウトに並べています。
  スクリーンリーダーのユーザーは、それを音で一つずつたどるので、欲しい情報にたどり着くまでに、時間と手間がかかることがほとんどです。
  たとえば気象庁の過去の気象データのダウンロードのページでは、リンクやボタンが画像や表の中のセルになっていて、授業でデータをダウンロードする学生は、それを見つけ出すだけで長い時間がかかっていました。
- **Todoku で変わること:** ページが、読むことやすることごとのカードの束になります（「新着情報を読む」「データを表示」「CSVダウンロード」など）。
  上下の矢印キーでカードを選び、Enter キーで読みます（ページのボタンやリンクをクリックするカードもあります）。
  Esc キーで戻ります。
  地点を選び、データを表示して、保存するまでが、一つずつ順にたどる操作になります。
  自動で切り替わっていくスライドショー（カルーセル）も、番号を付けて全部読めます。
  ページのリンクは全部、ページの中の場所ごとに並べて選べます（本物のつくば市のトップでは、157件を22枚のカードに分けました）。

### Claude がすること

1. **サイトのページが変わったとき、その場でカードを直します。**
   カードが読む場所やクリックする場所を見つけられなくなると、アプリは、当たらない行と、文字を全部落としたページの構造だけを Claude に送ります。
   Claude が新しい CSS セレクタを案として返し、アプリはそれを開いているページで試して、合うときだけ使い、カードを読み直します（「ページが変わったので、読む場所を直しました。」と知らせます）。
   Windows で本物の Claude を使ったときは、12〜17秒かかりました（2026年11月4日）。
   直しはこのパソコンの中だけに残り、元に戻せます。
   支援者が設定ファイルに書けば、ほかの人にも配れます。
2. **設定ファイルの無いページでも、カードの束を作ります。**
   同じ、文字を落とした構造から、Claude がカードの案を4〜8枚返します。
   アプリは一枚ずつ試し、カードのタイトルを自分で作り、主な表と本文の節のカードを足して、いつも同じ大事なカードがそろうようにします。
   Windows で本物の Claude を使ったときは、気象庁の警報のページで14〜35秒かかり、6〜9枚できました（2026年11月4日）。
3. **送るのは構造だけです。**
   ページの文字・URL・ページの題・リンク・名前・入力した値は、Claude に送りません。
   送るのは、要素の名前と入れ子の形と、短い英数字の id・class・role の名前だけです。
   送る文に日本語の文字が一つでも残っていれば、何も送りません。

Claude の API キーが無くても、この Claude の働きのほかは全部使えます。
試すには、`npm ci` の後に `npm start` です（下の「使い始める」をご覧ください）。

### できること

- ウェブアプリ（学習のサイト・市のサイトなど）ごとに、小さな設定ファイルがあり、どこを読み、どのボタンやリンクをクリックするかを、カードごとに書いてあります。
- アプリは、その設定ファイルをカードの束にします。
  上下の矢印キーでカードを移り、Enter キーかスペースキーでカードを開くか、ウェブアプリを読みます。
  読んだ結果は、上下の矢印キーで一件ずつ読めます。
  最後の項目で下矢印キーを押すと「ここが最後です。」、最初の項目で上矢印キーを押すと「ここが一番上です。」と知らせます。
  Esc キーで戻ります。
  Tab キーが止まるのは、いまのカードだけです。
  ウェブアプリそのものは、カードの画面の後ろの別のウィンドウにあり、キーボードの焦点を取りません（ログインのときだけ、使う人が前に出せます）。
- 番号の付いた一覧（`ol`）の項目は、「1 前の日の夜に、…」のように、頭に番号を付けて読みます（`start`・`reversed`・`value` に従います）。
  `list-style: none` で番号を出していない一覧には付けません。
- 表の行で、見出しの升目（`th`。無ければ最初の升目）にだけ文字があり、ほかの升目が全部空なら、「{名前} なし」と読みます。
  空の行を、読めなかった行と取り違えないためです。
- カードを選ぶと、タイトルの後に、そのカードの説明（設定ファイルの `description`）を読みます（`aria-describedby`。最初のページのカードと同じ形です）。
- `list` のカードは、当たる項目を番号付きで全部読みます。
  カルーセルや長いページの中で隠れている所も、「4件あります。1件目: …」と読めます。
  画像の中の文字は、`alt` と `aria-label` から読みます。
  カルーセルが `aria-hidden` で隠したスライドも、使う人が頼んだものなので読みます。
- `click` のカードは、先に確かめます。
  Enter キーを押すと「「{タイトル}」をクリックする」ボタンを出し、焦点をそのボタンに置くので、もう一度 Enter キーを押すとクリックします。
  「「{タイトル}」をクリックします。」は、ボタンの説明として読みます。
  クリックした後は「「{タイトル}」をクリックしました。」と知らせ、0.5秒を越えたときだけ「「{タイトル}」をクリックしています。」とも知らせます。
  画面と知らせで「押す」と言うのは、キーとボタンのときだけです。
  カードがページの上ですることは「クリック」、その相手は「ボタンやリンク」と呼びます。
- 表: 名前と値の二つの表に分けて横に並べて描かれた表は、行ごとに両方をつないで読みます（`joinWith`）。
  見出しの行の下に行をまとめた表（地域ごとの見出しの行の下に「特別警報」「警報」「注意報」の行が並ぶ表など）は、「北部 特別警報 なし、警報 なし、注意報 強風注意報、雷注意報」のように、まとまりごとに一件で読みます。
  表の題の下にある一つの升目だけの行（更新の時刻など）は、一件目の頭に付けて読みます。
- アプリの束の中では、ウィンドウの題が「Todoku - {束の名前}」になるので、ウィンドウの題からも、いまどの束にいるかが分かります。
  最初のページに戻ると「Todoku」に戻ります。
- ウェブアプリのページが変わって、設定ファイルの行が当たらなくなると、アプリは、どの行が当たらないかだけを知らせます。
  API キーがあれば、その場で直します（下の「使う人の側での自動の直し」）。
  支援者は、その直しを設定ファイルに書いて配れます。
- 書いている途中のページ（少しずつ出てくるチャットの返事など）は、書き終わるのを待って読みます（下の「書いている途中のページ」）。
- スクリーンリーダー: Windows 11 では、開発の間ずっと NVDA 2026.3 で使いました。
  2026年11月4日には、PC-Talker Neo でも手で確かめました（カードの移動・一覧のカードを読む・結果の知らせ）。
  macOS では VoiceOver で使う作りです。
  VoiceOver のクイックナビをオフにすると、上下の矢印キーでカードを選べることを、最初のカードで知らせます。
- 日本語入力: 探す欄で変換している間の Enter キーは、変換を確定するだけで、カードへは移りません（2026年11月4日に Windows 11 で手で確かめました）。

### 使い始める（Windows）

- 要るもの: Windows 10 か 11（x64 か Arm64）・Git・Node.js 22.12 以降（Windows 11 Arm64 の Node 26.13 で試しました）。
- コードを取る: `git clone <このリポジトリの URL>` を打ち、できたフォルダに `cd` で移ります。
- リポジトリのフォルダで、部品を入れます: `npm ci`
  - `npm ci` は Electron の本体を取りません。
    最初の `npm start`（か `npm run smoke`）が「Downloading Electron binary...」と出して取るので（120 MB ほど）、最初の起動は時間がかかります。
  - HTTP のプロキシの内側では、この取り込みが「fetch failed」で止まることがあります。
    `HTTPS_PROXY` と一緒に `NODE_USE_ENV_PROXY=1`（Node 24.5 以降）を設定すると、プロキシを通して取れます。
  - `npm ci` は、中くらいの脆弱性と、古くなった部品を一つ知らせます。
    npm 11 は、インストールのスクリプトについても警告します（`electron-winstaller` から）。
    どれも、インストーラーを作るためだけに使う包む道具（`electron-builder` とそれが使う部品）の中のもので、アプリそのものには入りません。
- 起動: `npm start`
  - 最初のページ（「Todoku」）が開きます。
    カードは、アプリの案内・表示設定・カードを探す・フォルダのカード・フォルダに入っていないウェブアプリごとのカード・「フォルダを作る」・「新しいページからカードを作る」です。
  - 結果は `role="status"` のライブリージョンで知らせ（誤りは `role="alert"`）、結果の項目はカードの中に入れるので、矢印キーで読み直せます。
  - アプリのデータ（`generated/` の作った束・`repairs/` のその場の直し・`config-backups/` の設定ファイルの控え・`settings.json` の表示設定・`bookmarks.json` のフォルダと表示名とメモ・`log.txt`）は、`%APPDATA%\Todoku` に置きます（2026年11月4日に Windows 11 の `npm start` で確かめました）。
    インストーラーで入れたアプリの置き場は、まだ確かめていません。
- テストを走らせる:
  - `npm test` は、Node に入っているテストの仕組みで単体テストを走らせます。
    Electron の本体は要りません。
    7件が飛ばされたと出ますが、Electron の中でだけ走る台本と、頼んだときだけ走る台本です（`npm run smoke`・`npm run voiceover:check` と下のもの）。
  - `npm run smoke` は、Electron の中で、`test/fixtures/` の練習のページに当てる通しのテストです（ネットワークは使いません）。
  - `npm run ui:repair` は、支援者の確認と直しの流れを、本物の主の処理の上で通して走らせます。
    偽の Claude と、作りの変わった練習のページを使い、「設定ファイルを確認する（支援者向け）」を押し、一つ目の案を使って二つ目を使わず、使った行だけが設定ファイル（一時のフォルダの中）に書かれ、控えが一つできることを確かめます。
    `UI_REPAIR_REAL=1`（と API キー）を設定すると、本物の Claude に頼み、そのときは案を書き出すだけです。
  - `npm run smoke`・`npm run ui:repair`・`npm run real:tsukuba` は、ウィンドウを隠したまま走り、前にあるアプリからキーボードの焦点を奪いません（macOS では Dock にも出ません）。
    だれかが文字を打っている間に走らせても大丈夫です。
    ウィンドウを見せたいとき（`ui:repair` の流れを見るときなど）は、`-- --show-windows` を足します。
  - `npm run smoke:windows` は、同じ smoke をウィンドウを見せて走らせ、本物のウィンドウの管理の上で焦点の動きも確かめます。
    ウィンドウが前に出るので、だれもパソコンを使っていないときだけ走らせてください。
- デモを撮る前: Todoku を閉じてから `npm run demo:reset` を走らせます。
  作った束（`generated/`）・その場の直し（`repairs/`）・表示設定（`settings.json`）・フォルダと表示名とメモ（`bookmarks.json`）を、アプリのデータのフォルダ（`npm start` と包んだアプリが使う `Todoku` と、前の版が使っていた `hackathon2026`）から、そこの `reset-backup/<日時>/` へ移します。
  何も消さず、移したものを書き出します。
  `npm run demo:reset -- --restore` で、いちばん新しい控えを戻します（戻す先にまたできたファイルは、上書きしません）。
- Windows のインストーラーを作る: `npm run dist:win`
  - インストーラー（`dist/Todoku Setup 1.0.0.exe`）と、入れずに使える版（`dist/Todoku 1.0.0.exe`）ができます。
    どちらも x64 と Arm64 の両方を含みます。
  - コードの署名をしていないので、Windows の SmartScreen が「発行元が不明」と出すことがあります。
  - 包んだアプリの中の設定ファイルは、書き換えられません。
    直したセレクタをアプリに書かせたいときは、設定ファイルを手元のフォルダ（`CARDS_LOCAL_DIR`）に置くか、作業のコピーから `npm start` で起こしてください。

### 使い始める（macOS）

- 要るもの: Apple シリコンの macOS・Git・Node.js 22.12 以降（Node 22.19 で試しました）。
- `git clone <このリポジトリの URL>` を打ち、できたフォルダに `cd` で移ります。
  リポジトリのフォルダで `npm ci`、続けて `npm start` です。
  Windows と同じく、最初の `npm start` が Electron の本体を取ります。
  `npm test` と `npm run smoke` も、Windows と同じに動きます。
- macOS でも、Todoku のウィンドウを閉じると、アプリは終わります（ウィンドウの無いまま Dock に残りません）。
- `npm run voiceover:check` は、VoiceOver が実際に何を読むかを確かめます。
  AppleScript で VoiceOver を起こし、Todoku を（一時のデータのフォルダで）開き、矢印キーでカードを移りながら、VoiceOver が最後に話した文を書き留めます。
  確かめるのは、最初のページのカードのタイトル、`test/fixtures/` の練習の市のページの一覧のカードの件数と項目、`role="status"` で知らせた結果です。
  本物のサイトは読みません。
  VoiceOver ユーティリティの「AppleScript による VoiceOver の制御を許可」と、クイックナビのオフが要ります。
  ウィンドウが出て VoiceOver が話すので、だれも Mac を使っていないときだけ走らせてください。
  失敗したときも、5分で時間切れになったときも、Ctrl+C のときも、最後に VoiceOver を止めます（走らせる前から動いていたときは止めません）。
- アプリのデータの置き場（Windows と同じファイル）: `npm start` も、`npm run dist:mac` で作ったアプリも、`~/Library/Application Support/Todoku` を使います（フォルダの名前は `package.json` の `productName` から決まります。2026年11月4日に macOS で確かめました）。
  作ったアプリのメニューの名前は「Todoku」です。
  `npm start` では、開発用の本体が自分の名前を持つので、メニューの名前は「Electron」のままです。
- プロキシの内側で Electron の本体を取れないときは、Electron のリリースのページから `electron-v<版>-darwin-arm64.zip` と `SHASUMS256.txt` を取り、SHA-256 を確かめ、zip を `node_modules/electron/dist` に展開し、`node_modules/electron/path.txt` に `Electron.app/Contents/MacOS/Electron` と書きます。
- macOS のディスクイメージを作る: `npm run dist:mac` で `dist/Todoku-1.0.0-arm64.dmg`（Apple シリコン用）ができます。
  署名も公証もしていないので、macOS が「開発元を確認できません」と出します。
  最初は、右クリックのメニューの「開く」から開いてください。
  - プロキシの内側では、Electron の zip と `SHASUMS256.txt` を入れたフォルダを `ELECTRON_CACHE` で指します。
    同じ `ELECTRON_CACHE` は、最初の `npm start` にも効きます。

### 設定（環境変数）

- `CARDS_LOCAL_DIR`（任意）: 足す設定ファイル（`*.json`）のフォルダです。
  同梱の `cards/` の後に読みます。
  公開したくないサイトの設定ファイルは、ここに置きます。
  すでに読んだものと `id` が重なる設定ファイルは読まず、そう知らせます。
- `CARDS_ANTHROPIC_API_KEY`（任意）: Claude にセレクタの直しと新しい束を頼むときの、Anthropic の API キーです。
  無いときは、直せない・作れないと知らせ、ほかは全部使えます。
  アプリは、わざと `ANTHROPIC_API_KEY` を読みません。
  同じパソコンのほかの道具の鍵と分けておくためです。
- `TODOKU_DUMP_DIR`（任意・開発する人向け）: 束を作るたびに、三つのファイルを書きます。
  `<id>-a-structure.txt`（Claude に送った、文字の無い構造）・`<id>-b-proposals.json`（Claude の返事のまま）・`<id>-c-deck.json`（アプリの守りを通した後の束と、カードのタイトル、作らなかった案とその短い理由）です。
  ページの文字（タイトル）は三つ目にだけ入るので、人に見せてよいのは初めの二つだけです。
- `TODOKU_YOUTUBE_API_KEY`（任意）: YouTube Data API v3 のキーで、YouTube のカード（下）だけが使います。
  キーは主の処理の中だけに置き、カードの画面には渡さず、ファイルやログにも書きません。
  無いときは、YouTube のカードが「YouTube の API キーが設定されていません。」と知らせ、ほかは全部使えます。
- `CARDS_REPAIR_MODEL`（任意）: Claude を呼ぶときに使うモデルです（直しと、新しい束の両方）。
  既定は `claude-opus-5-5` です。
- `https_proxy` / `HTTPS_PROXY`（任意）: Electron に `--proxy-server` として渡し、プロキシの要るネットワークから外のページに届くようにします。
  `no_proxy` / `NO_PROXY`（任意）は `--proxy-bypass-list` として渡します。
  無いときは、プロキシの指定を足さず、OS のプロキシの設定に従います。
  起動のとき、使うことになるプロキシ（これらの環境変数か OS の設定から）に届くかを2秒で試します。
  届かないとき（学外にいるのに、OS の設定が学内のプロキシを指したままのときなど）は、OS の設定は変えずに、アプリの中だけ直に繋ぎ、そのことを一行、端末（`npm start` で起こしたとき）と、アプリのデータのフォルダの `log.txt` に書きます。
  どの行も、パソコンの時刻と UTC からのずれで始まります（`2026-11-04T09:30:05.123+09:00` など）。

### ダウンロード

- クリックのカードがウェブアプリのウィンドウでダウンロードを始めたら、アプリは、保存のダイアログを出さずに、ファイルを使う人のダウンロードのフォルダに保存します。
  名前は元の名前（同じ名前があれば「 (1)」「 (2)」…を足します）か、設定ファイルにカードの `saveAs` があればその名前です。
  保存したら「「ファイルの名前」をダウンロードのフォルダに保存しました。」と知らせます（保存できなかったときも、そう知らせます）。

### Claude に送るもの

- アプリが集めるのは、ページの構造だけです。
  要素の名前と入れ子の形に、id・class・role・aria-*・data-* の値と、`type` と `name` を添えます。
  ページの文字・リンク・画像の出どころ・`title`・`alt`・入力した値は全部落とし、`script`・`style`・`svg`・`iframe` は飛ばします。
  文字を持つ要素には「(has text)」の印だけを付けます。
  値が人の読む文字になる属性（`aria-label` など）は、名前だけを残します。
- 値を残すのは、短い英数字の名前（英字・数字・`_`・`:`・`-` の40字まで）のときだけです。
  それでも、人や記録を指しうる値は落とします。
  5桁以上の数字の並びを含むもの（学籍番号のような id）、GUID、数字を含む12字以上の英数字です。
  この決まりに合わない id や class は外し、ほかの属性は名前だけを残します。
  `role` も同じです。
- 送る前に、頼む文の全体を確かめます（`looksTextFree`）。
  日本語の文字（ひらがな・カタカナ・漢字・全角の文字・日本語の句読点）が一つでもあれば、何も送りません。
  直しのときも、新しい束のときも同じです。
  ただし、名前として正しい英単語は見分けられないので、英語のページの id や class の名前は、名前として Claude に届くことがあります。
- 直しのときは、Claude は当たらない行も受け取ります（設定ファイルの中の場所、英数字のときだけカードの id、カードの働き、前のセレクタ。英数字でない文字は「…」に置き換えます）。
  Claude は、直したセレクタと短い理由を返します（構造化出力）。
  カードのタイトルは送りません。
  作った束のタイトルは、ページの見出しから来ているためです。
- 直しのときに確かめで止まったら、カードは直せなかったと知らせます。
  アプリが自分で作るセレクタには、英数字の名前でない id を使いません。
- 何を配るかは、支援者が決めます。
  直しを設定ファイルに書くのは、支援者向けのカード（下）からだけで、前のファイルはアプリのデータのフォルダ（`config-backups`）に控えを残します。
  支援者は、一つのアプリの全部のカードを一度に確かめることもできます。
  アプリの束の一枚目（アプリの案内のカード）に、「設定ファイルを確認する（支援者向け）」ボタンがあります（出典のボタンの前）。
  押すと、一枚のカードの束を開き、当たらなくなった行と、API キーがあれば行ごとの Claude の案を、一つずつ並べます。
  案は、いまのセレクタ・案のセレクタとページで見つかる数・理由を、「いまのセレクタ: …」のような一行ずつで読みます。
  「…の直しを使う（設定ファイルに書く）」（前の版を `config-backups` に残して設定ファイルに書く）と「…の直しを使わない」のボタンがあります。
  書くのに0.5秒を越えたら、一度だけ「書いています。」と知らせます。
  決めると、焦点はその案の行に移り、その行が結果を読みます（「…: この直しを使いました。設定ファイルに書き、前の版はバックアップとして残しました。」）。
  下矢印キーで次の案へ進みます。
  使わなかった行も、API キーがあれば使う人の側でその場で直すことを、カードの中で知らせます。
  API キーが無いときは、当たらない行の一覧だけを読みます。
  Claude に送るものは、上と同じ決まりです。

### 使う人の側での自動の直し

- きっかけ: `read`・`list`・`click` のカードが、ページの上で何も見つけられなかったとき（「読めません」）です。
  `container` で見つけた空の一覧は「0件」で、読めないのではありません。
  ログインの画面・書き方の誤った設定ファイル・開けなかったページは直しません。
- アプリは、すでに開いているページの構造を（読み込み直さずに）集め、ページの文字が入っていないことを確かめてから、当たらない行とその構造だけを Claude に送ります。
  待つのは長くても45秒です。
  待つ間は、いつもの「読んでいます」の進み具合の知らせで、カードを直していることを伝えます。
- 案は、いまのページで試し、確からしいときだけ使います。
  `read` は文字を持つ要素に一つ以上、`list` は項目に一つ以上、`click` はちょうど一つの要素に当たることです。
- 使った後、`read` と `list` のカードは読み直し、「ページが変わったので、読む場所を直しました。」と一度だけ知らせます。
  `click` のカードはクリックし直さず、直したことを知らせ、もう一度クリックするかは使う人に任せます。
- 直しはこのパソコンの中だけに効きます。
  同梱の `cards/*.json` は変えません。
  アプリごとに、アプリのデータのフォルダに上書きのファイル（`repairs/<アプリの id>.json`）を作り、カード・元のセレクタと新しいセレクタ・Claude の理由・時刻を残すので、起動し直しても直しは効きます。
  新しい設定ファイルがそのセレクタを変えたときは、上書きを使いません。
- 元に戻す: 直したカードには「直す前に戻す」ボタンがあります。
  支援者は、アプリのカードの最後の「自動で直した場所（支援者向け）」のカードで、自動の直しを全部見て、一つずつ設定ファイルに書く（使った案と同じく、`config-backups` に控えを残します）か、元に戻せます。
- 「直す前に戻す」の後、焦点は同じカードの中の最初の項目に移るので、Esc キーを一度押してもカードに戻るだけで、束からは出ません。
- API キーが無いとき・Claude が失敗したとき・時間切れのとき・案が確からしくないときは、今までどおり「読めません」と知らせ、最後に短い理由の一文を足します（「自動で直すこともできませんでした（Claude の API キーがありません）。」など。ほかの理由は「時間内に終わりませんでした」「確かな直しの候補がありませんでした」「Claude が直しの候補を作れませんでした」）。
  クリックのカードも、「クリックできませんでした」の知らせに同じ一文を足します。

### 設定ファイルの無いページのカード

- 最初のページ（「Todoku」）に「新しいページからカードを作る」のカードがあります。
  その上で Enter キーかスペースキーを押すと、ラベルの付いた URL の欄（「ページのURL（http か https で始まるもの）」）へ移ります。
  受け付けるのは `http://` と `https://` だけです。
  欄の中で Enter キーを押すか、「作り始める」ボタンを押すと始まります。
- アプリはページを開き、要素の数・文字の量・読み込んだ部品の数が変わらなくなるまで待ちます（長くても15秒）。
  それから、直しのときと同じ、文字の無い構造を集めます（`looksTextFree` を通ることが条件です）。
  Claude が受け取るのは、その構造だけです。
  ページの文字も、URL も、ページの題も送りません。
  構造は、`structure.js` で2,500要素まで、送る前に120,000字までに抑え、切ったときは Claude にそう伝えます。
- Claude は、設定ファイルの形でカードを4〜8枚返します（zod の構造化出力）。
  `role`（heading・main・list・notice・table・menu・search・button・link・other）・`action`（`read` / `list` / `click`）・`selector`・`container`（一覧のカードだけ）・`titleSelector`（カードのタイトルにする要素）と、一文の理由です。
- カードのタイトルは、Claude ではなく、このパソコンの中で作ります。
  `titleSelector` の要素は、カードの場所のもの（その中か、すぐ前の見出し）のときだけ使い、そうでなければ、その場所の見出し・`aria-labelledby`・ランドマークのラベル・最初の短い文字を使います。
  `click` のカードは、クリックする要素の名前をタイトルにし、一語のときは分かりやすくします（「市町村選択」は「市町村を選ぶ」、地名は「地域を選ぶ（…）」、「検索」は「サイト内を検索する」）。
  表示を切り替えるボタン（タブ・`aria-controls`・`aria-pressed`・`aria-selected` のあるもの、三つ以上並んだボタンの一つ）は、表を切り替えるなら「表を替える（…）」、そうでなければ「表示を替える（…）」にします。
  長いタイトルは、言葉の切れ目で切ります。
  束の名前は、ページの `<title>` からサイトの名前の部分を除いたもので、これもこのパソコンの中だけで使います。
- 案のカードは一枚ずつページで試し、合わないものは外します。
  `read` は文字を持つ要素、`list` は一つ以上の項目、`click` はちょうど一つの要素に当たることが条件です。
  タイトルを作れないカード、名前の無い要素の `click` のカード、中身が一語か見出し一行だけのカード、パンくず、重なりも外します。
  日付だけの行（「最終更新日：…」）や「リンク」「詳細」「もっと見る」のような一語は、タイトルにしません。
  目次は「目次を読む」の一枚にまとめます。
  Claude のカードは8枚までにします。
- Claude によらない守り:
  - 本文の最初の表と、いちばん大きな表（どちらも3行以上。表が無いときだけ、いちばん大きな一覧）には、Claude が案を出さなくても、いつもカードを作ります。
    自分の題（`caption` か、頭の一つの升目の題の行）のある表も、3枚まで、行が少なくても作ります。
    リンクやボタンだけの一覧や表（メニューや選ぶ所）は選びません。
  - 表は、一つの表に一枚のカードで読みます。
    おもに表を読む Claude のカードは、表ごとの一覧のカードに分け、表の題をタイトルにします。
    分けた表の題の部分だけを読むカードは、その表のカードにします。
    一つの表の行の一覧は、その表の題をタイトルにします。
    表の升目だけの一覧や、二つの表にまたがる行の一覧は、その表のカードがあるので外します。
  - 表のそばに、表を切り替えるボタンが三つ以上並んでいれば、Claude の案に無くても「表を替える（…）」のカードを足します。
  - ページの上に描かれていない所（「▼ 説明を表示する」を押すまで畳まれている説明など）を読むカードは作りません。
    回る帯（カルーセル）と、畳まれたリンクのメニューは作ります。
  - 日時だけのタイトル（「…更新」）は使わず、タイトルの頭の記号（▼・■・●・※ など）は、スクリーンリーダーがそのまま読むので落とします。
  - 本文の見出しごとの節を読むカードを、10枚まで足します（上の二つの段の見出しで区切ります）。
    `until` で、見出しから次の見出しの手前までを読みます。
    40字に満たない節は飛ばします。
    本文を丸ごと読む Claude のカードで、その見出しを二つ以上含むものは、節のカードに置き換えます。
    「目次に戻る」のような、ページの中を戻るだけの一行は読みません。
  - カードは、ページの上からの順に並べます。
    ただし、ページの部品（更新日・ページ番号・印刷・文字の大きさだけのカード）・お問い合わせ・サイトのメニューとサイトの名前のカード（「〇〇市役所」など）・検索は、この順で最後にまとめます。
  - メニューのカードのタイトルは、メニューの `aria-label`・すぐ前の見出し（か `dt`）・最初の項目から「〇〇のメニュー」にします。
    項目のほとんどが地名なら「地域のメニュー」、何も取れなければ「サイトのメニュー」です。
  - ページの目次が指す見出し（`id` か古い形の `a[name]`）は、短くても節にします。
    一覧を含む節は、その一覧のカードに置き換えず、節のまま残します。
  - Claude の案は回ごとに変わります（モデルの `claude-opus-5-5` は `temperature` の設定を受け付けません）。
    そこで、これらの守りで束が同じになるようにしています。
    smoke のテストでは、作り物の気象の警報のページに十の形の案を当てても、いつも同じ大事な4枚と、6〜8枚のカードになります。
    本物の気象の警報のページに Claude が返した11回の案も、保存したページのコピーで、同じ大事なカードと6〜7枚になりました（コピーはリポジトリに入れていません）。
- 残ったカードは、アプリのデータのフォルダに新しい設定ファイル（`generated/<id>.json`）として保存し、次の起動でも最初のページに出ます。
  Claude が考えている間は、いつもの進み具合の知らせで、たった秒数を知らせます。
  全体は90秒で時間切れにします。
  できたら新しい束を開き、「「{名前}」のカードを{N}枚作りました。」と一度だけ知らせます。
  できなかったら、理由を一文で知らせ、URL の欄をもう一度出します。
- 作った束の一枚目には、ボタンが二つ増えます。
  「設定ファイルとして書き出す（支援者向け）」は、束を `todoku-<id>.json` としてダウンロードのフォルダに書き出すので、支援者が確かめて、ふつうの設定ファイルとして配れます。
  「このアプリのカードを消す」は、束とその直しを消します。
- この入口があるので、設定ファイルが一つだけのときも、最初のページをいつも出します。

### 書いている途中のページ

- カードが読む要素か、その外側・内側の要素に `aria-busy="true"` が付いている間（書いている途中のチャットの返事など）は、それが外れるまで、いつもの待つ長さ（8秒）まで待ちます。
- それでも書いている途中なら、そこまでを読み、「「{タイトル}」を読みました。まだ書いている途中です。」と知らせます。
  カードには「まだ書いている途中でした。ここまでを読みました。もう一度読むと、続きが読めます。」の項目を一つ足します。
- `aria-busy` を付けないページは、そのときの文を読みます。

### 表示設定と探す

- 最初のページの二枚目は「表示設定」で、授業の教材のカード型ページと同じ三つの設定です。
  ふだんは「表示設定を開く」ボタン一つだけで、Enter キーかスペースキーで開いたり閉じたりします。
  読みやすさは「標準」と「ゆったり」（文字・単語・行の間を広げ、1列にします）です。
  「1列リフロー表示」の有効と無効（項目の見出しと内容を1列にし、最大の幅を外します）があります。
  配色は「標準（配色変更なし）」「高コントラスト（白地）」「高コントラスト（黒地）」です。
  「表示設定を標準に戻す」で三つを戻します。
- 変えるたびに、「配色を「高コントラスト（黒地）」にしました。」のように一文で一度だけ知らせ、ボタンの文字でも状態を言います（「、選択中」や「1列リフロー表示: 有効」）。
  NVDA は、選ばれているボタンを「押されています」（切り替えの状態）と「選択中」の両方で読みます。
  切り替えの状態を読まないスクリーンリーダーのために、文字を残しています。
- 文字の大きさ: Ctrl キー（macOS では Command キー）とプラス・マイナス・0 で変えます。
  ウィンドウにメニューが無いので、アプリがこのキーを自分で受け、新しい大きさを一度だけ知らせます（「文字の大きさを110%にしました。」）。
  「表示設定を標準に戻す」は、文字の大きさを変えません。
- 設定と文字の大きさは、アプリのデータのフォルダ（`settings.json`）に残し、次の起動で、カードを作る前に当てます。
  知らない値は標準に戻します。
  OS が色を決めているとき（Windows のハイコントラスト）は、OS の色を優先します。
- 対比: 三つの配色のどれでも、焦点のある項目と選ばれたボタンを含めて、文字は7:1以上、線は3:1以上です。
  `test/settings.test.js` が `style.css` から色を読み、全部の組み合わせを測り、`index.html` の頭に書いた最小の値と合うかを確かめます。
- 三枚目の「カードを探す」は、全部のアプリのカードを、タイトルと説明から探します。
  アプリの名前と、使う人が付けた表示名とメモからも探します（下の「最初のページのフォルダ・名前・メモ」）。
  見つかったカードは、そのすぐ後に、アプリごとに一枚、アプリの名前と件数の見出しで並びます。
  見つからなかったアプリのカードは出しません。
  打ち終えたら、合計を一度だけ知らせます（「3件見つかりました。」か「見つかりませんでした。別の言い方でお試しください。」）。
  欄の中で Esc キーを押すと探すカードに戻り、下矢印キーで最初の見つかったカードへ移ります（欄の中の Enter キーでも移ります）。
  「「{タイトル}」へ移る」ボタンを押すと、そのアプリの束のそのカードを開き、Esc キーで見つかったカードに戻ります。
  全角と半角、大文字と小文字、ひらがなとカタカナは区別しません。
  空白で区切ると、「全部の言葉を含む」という意味になります。

### ページのリンク・元のページ・既定のブラウザ

- アプリの束（設定ファイルの束も、Claude が作った束も）の終わりに、「このページのリンク」のカードがあります。
  Enter キーを押すと、そのアプリのページのリンクを一件ずつ、リンクの文字（無ければ `aria-label`、リンクの中の画像の `alt`）で読みます。
  並べるのは `http` と `https` のリンクだけです。
  同じページの中の場所へのリンク（`#…`）・そのページそのものへのリンク・名前の無いリンク・重なり（`#…` を除いて同じ行き先）は除きます。
  リンクの文字はこのパソコンの中で読むだけで、Claude に新しく送るものはありません。
- リンクがページの二か所以上にあるときは、場所ごとに一枚のカードの束で開きます。
  たとえば「本文（リンク4件）」「トピックス（リンク17件）」「メニュー（リンク47件）」「フッター（リンク7件）」「そのほか（リンク5件）」です。
  場所は、ページのランドマーク（`main`・`nav`・`header`・`footer`・`aside`・`role="search"`、名前のある `section` と `role="region"`。`role` で書いたものも含みます）と、`main` の中の h2・h3 の節です。
  場所の名前は `aria-label`・`aria-labelledby`・最初の見出しから取り、無ければ「本文」「メニュー」「ページの上」「フッター」などにします。
  本文を先に並べ、言語の切り替えや「スマートフォン版」のようなページの道具は、最後の「そのほか」に入れます。
  どのリンクもちょうど一枚に入るので、件数の合計は全部の件数と同じです（本物のつくば市のトップで157件が22枚。2026年11月6日に macOS で確かめました）。
  分けるのはこのパソコンの中で、Claude には何も送りません。
- リンクの文字が数字だけか1〜2字だけのとき（カレンダーの日付の「6」など）は、`aria-label` か `title` を読み、無ければ場所の名前を前に付けて読みます（「イベント情報：6」）。
- リンクの上で Enter キーを押すと、その行き先の束がすでにあれば（設定ファイルか Claude が作った束で、束の `url` かカードの `path` が合うもの）、その束（のそのカード）を開きます。
  無ければ、先に「このページは、まだ Todoku で読めるようになっていません。これから Claude がカードを作ります。90秒ほどかかります。」と知らせます。
  ボタンは三つで、「カードを作って開く」（「新しいページからカードを作る」と同じ流れ）、「既定のブラウザで開く」、「やめる」です。
  Esc キーで同じリンクに戻ります。
  このことはカードの説明で一度だけ言い（「まだ読めないページは、開く前に確認します。」）、リンクごとにはくり返しません。
- P キーか、アプリの一枚目のカードの「元のページを表示する」ボタン: 元の Web ページを、そのままの見た目で、自分のウィンドウに前に出して見せます（気象庁のページがどれだけ複雑かを見せるときなど）。
  そのウィンドウで Esc キーを押すと、Todoku に戻ります。
  そのウィンドウを閉じたときも、Todoku に戻ります。
  まだ開いていないページは、開いてから出します。
- B キーか、アプリの一枚目のカードの「いまのページを既定のブラウザで開く」ボタン: アプリのいまのページ（ウェブアプリのウィンドウが開いているページか、設定ファイルの `url`）を既定のブラウザで開きます。
  開くのは `http` と `https` のページだけです。
- P キーと B キーは、先に何をするかと戻り方を知らせ（「元のページを表示します。元のページでEscキーを押すと、Todoku に戻ります。」）、1秒ほど待ってから、ほかのウィンドウを前に出します。
  ほかのウィンドウが前にある間は、Todoku の知らせが聞こえないためです。
  キーは Windows と macOS で同じで、カードの上でも項目の上でも使えます（入力欄の中では使えません）。
  最初のページでは、「このキーは、アプリのカードを開いているときに使えます。」と知らせるだけです。
  二つのボタンには `aria-keyshortcuts` を付けています。

### 最初のページのフォルダ・名前・メモ

- 最初のページを、ブックマークのように使えます。
  「フォルダを作る」のカードでフォルダを作ります。
  Enter キーで名前の欄へ移り、欄の中で Enter キーを押すと作ります（「「天気」フォルダを作りました。」）。
  フォルダのカード（「天気（フォルダ）」）は、フォルダに入っていないページのカードの前に並びます。
  フォルダのカードで Enter キーを押すと、フォルダを開きます。
  フォルダの一枚目のカードで、名前を変えたり、フォルダを消したりできます（中のページのカードは最初のページに戻り、「…中のページのカード1件は、最初のページに戻しました。」と知らせます）。
- アプリの束の最後に「名前・メモ・フォルダ」のカードがあります。
  表示名とメモの欄と、フォルダごとのボタン（「「天気」フォルダに入れる」「「天気」フォルダから出す」）があります。
  表示名を付けると、ページのカードはその名前で読まれ、説明の頭で一度だけ元の名前を読み、次にメモを読みます。
  変えるたびに、一度だけ知らせます（「「よく見るアプリ」を「天気」フォルダに入れました。」）。
  新しいキーは足していません。
  全部、カードの中の欄とボタンでできます。
- 「カードを探す」は、アプリの名前・表示名・メモからも探し、当たったら「「{名前}」のカードを開く」ボタンを足します。
- 新しく作った束（URL からもリンクからも）は、最初のページの、どのフォルダにも入っていない所に足します。
  これらは全部、アプリのデータのフォルダの `bookmarks.json` に残します。
  このファイルが壊れていても、フォルダの無い状態で起動します。
  `npm run demo:reset` は、ほかの保存と一緒に、このファイルも控えへ移します。

### YouTube のカード

- `cards/youtube.json`（「YouTube の動画」）で、youtube.com をウィンドウで開かずに、YouTube の動画を探して再生します。
  一覧は公式の YouTube Data API v3（`search.list` と、長さのための `videos.list`）から取り、一件を「タイトル・長さ・公開日・チャンネル名」で読みます。
  一件で Enter キーを押すと、再生のカードに移り、公式の埋め込みプレーヤー（`youtube-nocookie.com`）で再生します。
  プレーヤーは、カードの画面の中に 640×360 で見える形で置き、上に何も重ねません。
  ボタン（再生・一時停止・10秒戻る・10秒進む・音量を上げる・下げる）はプレーヤーの下にあり、焦点はプレーヤーの中ではなく、このボタンに置きます。
  スクリーンリーダーがプレーヤーの中で迷わないためです。
  音量を変えると、「音量を60%にしました。」のように新しい大きさを知らせます。
  再生は、プレーヤーを読み込み、半分以上が画面に見えてから始めます。
- 探す言葉は YouTube（Google）に送られます。
  Todoku は探す言葉も結果も保存しません（探すたびに API に問い合わせます）。
  YouTube の束の一枚目でもそう知らせ（「検索の言葉は YouTube（Google）に送られます。Todoku は保存しません。」）、YouTube の利用規約（https://www.youtube.com/t/terms）と Google のプライバシーポリシー（https://policies.google.com/privacy）を既定のブラウザで開くボタンを置いています。
  YouTube のカードを使うことは、YouTube の利用規約に同意することになります。
- 使うのは API と埋め込みプレーヤーだけで、youtube.com のページを読んだり操作したりはしません。
  埋め込みプレーヤーには、だれが埋め込んでいるかを伝えます。
  カードの画面は手元のファイルなので、そのままでは `Referer` を送らず、プレーヤーが再生を断ります。
  そこで、`www.youtube-nocookie.com` への頼みには、アプリの id（`package.json` の `build.appId`）を `Referer` として付けます。
  プレーヤーの中の、新しいウィンドウを開くリンク（「YouTube で見る」）は、既定のブラウザで開きます。
- YouTube の設定ファイルは `"kind": "youtube"` で、`url` は書きません。
  カードの働きは、`youtube-search`（探す欄）・`youtube-channel`（一つのチャンネルの新しい動画。`channelId` に UC で始まる24字の id）・`youtube-player`（再生のカード。ちょうど一枚要ります）です。
  初めの二つには、`maxResults`（1〜50。既定は10）を書けます。
- API キーは環境変数 `TODOKU_YOUTUBE_API_KEY` から読みます（上の「設定（環境変数）」）。

### 設定ファイルの形（短く）

- `id`・`name`・任意の `description`（アプリの説明。出典など。アプリの一枚目のカードの最後の項目として読みます。スクリーンリーダーは URL をほぼ一文字ずつ読むので、URL は書かないでください）・任意の `sourceUrl`（出典の `http(s)://` のページ。アプリの一枚目のカードに「出典のページを開く」ボタンが付き、既定のブラウザで開きます）・`url`（`http(s)://...` か、練習のページの `fixture:<名前>.html`）・任意の `login`（ログインが要ることを示す `selector` と、ログインのページの `path`）・`cards` です。
- カードは、`id`・`title`・`action`（`read` は一つの要素を読む、`list` は当たる項目を全部番号付きで読む、`click` はクリックする）・`selector`・任意の `path`（同じサイトの別のページ）・`description` です。
  ほかに、働きごとに書けるものがあります。
  - `click` のカードだけ: `saveAs`（カードが始めたダウンロードを保存する名前。`{date}` は保存した日（yyyy-mm-dd）、`{n}` は使われていない1からの番号。名前に拡張子が無ければ、元の拡張子を足します）。
  - `list` のカードだけ: `container`（項目を入れる要素のセレクタ）。
    入れ物に当たって項目が無ければ「0件」、入れ物にも当たらなければ「読めません」です。
    `container` が無いと、項目が無いときは「読めません」になります（空の一覧と、変わった画面を見分けられないためです）。
  - `list` のカードだけ: `dateSelector`（項目の中の日付の要素）。
    ページが日だけを見せているとき、その要素の `datetime` か `id` に書かれた年・月・日（`2026-11-06` や `calendar_list_2026_11_6` の形）を読み、「11月6日」と読みます。
    そのような日付の項目が出てくるまで待ちます。
    日付の要素が項目の外にあるとき（一日一行に催しがいくつもある表など）は、項目の行の中で探し、日付と曜日を各項目の前に付けます。
  - `list` のカードだけ: `tagSelector`（項目の中の分類の言葉。タイトルの後に括弧で読みます）。
  - `list` のカードだけ: `skipItemsMatching`（正規表現）。
    文がこれに当たる項目は読まず、数にも入れません（たとえば `"PR|広告"` で、お知らせの一覧から広告を外します）。
    設定ファイルの束では、文がこれに当たるリンクも「このページのリンク」に出しません。
  - `list` のカードだけ: `undatedLabel`（「固定の記事」のような短い印）。
    ほかの項目が日付で始まるのに日付で始まらない項目は、頭に「固定の記事、」を付けて読み、日付の無い項目だと分かるようにします。
    「＼Hot!／」のような頭の飾りは、どの一覧でも、斜めの線を読みません。
  - `list` のカードだけ: `joinWith`（二つ目の表の行）。
    n件目の後ろに、この表の n行目をつないで読みます（二つの表に分けて描かれた横に長い表のためです）。
  - `list` のカードだけ: `itemTarget`（一覧の一件で Enter キーを押したときに読む所）。
    `label`（「返事」のような、知らせで使う呼び名）と、`closest`（項目から上へたどる要素）・`next`（その後ろの兄弟で最初に当たる要素）・`find`（その中で読む要素）のうち一つ以上を書きます。
    結果は「3件目の返事」の一枚のカードで開き、Esc キーを二度押すと同じ項目に戻ります。
    一覧を読むとき、アプリは一件ごとに短いハッシュ（文字そのものではありません）を覚えておきます。
    一件を選ぶと、いまのページで同じハッシュの項目を探すので、上に新しい発言が増えても、選んだ一件を読みます。
    その一件が無くなっていれば、「「{タイトル}」を読んだ後に画面が変わりました。もう一度「{タイトル}」を読んでください。」と知らせます。
    例: 練習のチャットでは、`{ "label": "返事", "closest": "li.turn", "next": "li.ai", "find": ".body" }` で、選んだ質問への返事を読みます。
  - `read` のカードだけ: `until`（セレクタ）。
    当たった要素と、その後ろの兄弟の要素を、`until` に当たる最初の要素の手前まで読みます。
    Claude が作る本文の節のカードは、これで見出しから次の見出しの手前までを読みます。

### 同梱の例

- `cards/moodle-demo.json`: Moodle の公開のデモサイト（https://school.moodledemo.net/）です。
  デモは多くの人が使い、1時間ごとに元に戻ります。
  アプリがこのサイトを開くのは、使う人がカードを選んだときだけです。
- `cards/tsukuba-city.json`: 本物の市のサイト、つくば市公式ウェブサイト（https://www.city.tsukuba.lg.jp/）です。
  緊急情報・新着情報・お知らせ・今月のイベント情報（イベントカレンダーのページから）・トップのスライドショー（「スライドショーのお知らせを全部読む」）とピックアップのスライドショーの全部（回すために作られた写しは読みません）・くらしの場面ごとの案内を読みます。
  サイト内の検索は、検索の欄が外の検索サービスの部品で、Todoku のカードはまだ文字を入れられないので、カードにしていません。
  アプリの一枚目のカードで「出典：つくば市公式ウェブサイト。」と読み、公式サイトを開くボタン（`sourceUrl`）があります。
  アプリは市のページを自分のウィンドウで開き、書いてあるとおりに読むだけで、ページを書き換えたり、フレームの中に入れたりはしません。
  `npm run real:tsukuba` で、本物のサイトで全部のカードと自動の直し（偽の Claude と、わざと古いセレクタを一つ含む写し `test/tsukuba-city-old-line-for-test.json` を使います）を確かめます。
  サイトを3回読み込むので、くり返さず、手で一度ずつ走らせてください。
- `cards/jma-forecast.json`・`cards/jma-daily.json`・`cards/jma-obsdl.json`: 気象庁のページです（東京の天気予報・日ごとの過去の気象データ・過去の気象データのダウンロードのフォーム。フォームの手順ごとにクリックのカードがあります）。
- `cards/ntut-top.json`・`cards/ntut-kyosei.json`・`cards/ntut-magazine.json`: 筑波技術大学の公開のサイトです（大学・学部の一つ・ウェブマガジン）。
  一部の種類のお知らせは一覧で読みません（`skipItemsMatching`）。
  同じ言葉を含むリンクも「このページのリンク」に出しません（設定ファイルの束だけで、Claude が作った束には効かせません）。
- `cards/practice-city.json` と `test/fixtures/city-top.html`: 作り物の市のサイト（「みどり市」）で、自動で回るカルーセルなど、よくある壁があります。
  作り物で、実在の市のサイトをもとにしてはいません。
- `cards/practice-chat.json` と `test/fixtures/chat.html`: 作り物のチャットの画面（「ことのはチャット」）で、12回の質問と返事、過去のチャットの一覧、少しずつ書かれる最後の返事があります。
  最後の返事・自分の質問の全部（質問の上で Enter キーを押すと、その返事を読みます）・全部の発言の順（上下の矢印キーで発言を移ります）・過去のチャットの一覧・最後の返事のコードの部分を読みます。
- `cards/practice-course.json` と `test/fixtures/course-before.html` / `course-after.html`: レイアウトが変わる前と後の作り物の講座のページで、直しの流れを見せるために使います。
- 練習のページの名前は、全部作り物です。

### Claude の使い方

- アプリの中: Claude（既定は `claude-opus-5-5`）が、上に書いたとおり、ページの構造から直したセレクタを案として返します。
- アプリの中: 設定ファイルの無いページでは、同じ文字の無い構造から、Claude がカードの束を丸ごと案として返します。
- Claude がしないこと: ページを読むこと、カードのタイトルを作ること、案を試すこと、何を残すかを決めることは、全部このパソコンの中のアプリがします。
- 開発: アプリは Claude Code で作りました。
  Windows の Claude Code がアプリの大部分を書き、NVDA で確かめました。
  macOS の Claude Code は、変更を見直し、この README と手元の非公開の設定ファイルを書き、push の前に毎回、名前と個人の情報を点検しました。

### テスト

- `npm test`: 159件。152件が通り、7件は飛ばし（Electron の中でだけ走る台本）、落ちたのは0件です。
- `npm run smoke`: 257件。257件が通りました（練習のページと、決して答えない手元のテスト用のサーバだけに当てます）。
- `npm run real:tsukuba`: 13件。本物のつくば市のサイトで、13件が通りました。
- `npm run smoke:windows`: 同じ確かめをウィンドウを見せて走らせ、本物の焦点の動きの1件を足したものです（258件。258件が通りました）。
- 四つとも、2026年11月6日に macOS で測りました。
  2026年11月4日（テストがまだ少なかったとき）には、このリポジトリを新しく clone して「使い始める（macOS）」のとおりに `npm run smoke` を、Windows 11 でも新しく clone して「使い始める（Windows）」のとおりに `npm test` と `npm run smoke` を走らせました。
  `npm run real:tsukuba` は本物のサイトを読み込むので、手で走らせるだけにしています。

### これから

- 声で Web を使う人のためのブラウザ: だれかが設定ファイルを書いたサイトだけでなく、どのページにも届くことを目指しています。
  新しいページのカードを作ることと、その場で直すことは、その最初の一歩です。
- 利用者の間で束を分け合う形（まだ作っていません）。
  設定ファイルの無いページを開いたら、Todoku がその場で束を作り、その設定をサーバに上げておきます。
  次にだれかが同じページを開いたときは、すぐにカードを使えます。
  上げるのは、構造の情報だけです（セレクタ、カードの働き（読む・一覧・クリック）、カードの並び）。
  カードのタイトルもページの文字なので上げず、受け取った側が自分のパソコンで、ページの見出しから付け直します。
  ログインの要るページかどうかで分けず、どのページも同じ決まりにします。
  分け合う設定ファイルも、配る前に支援者が確かめる今の流れを通します。
- チャットの画面で、やり取りをさかのぼったり追いかけたりする形。
  試したのは作り物のチャットの画面（`test/fixtures/chat.html`）だけです。
  本物のチャットのサービスには当てていません。
  各社の利用規約が、画面への自動の手段でのアクセスを制限しており、支援技術のための例外が書かれていないためです。

### 使った部品

| 部品 | 版 | 使用許諾 | 使い道 |
|---|---|---|---|
| electron | 45.2.1 | MIT | 動かす土台（開発と包むとき） |
| electron-builder | 26.18.0 | MIT | 包むときだけ |
| @anthropic-ai/sdk | 1.3.0 | Apache-2.0 | Claude を呼ぶ |
| zod | 4.6.7 | MIT | 構造化出力の形 |
| @electron/asar | 4.3.1 | MIT | 包むときだけ（版の上書き） |
| rimraf | 5.0.10 | ISC | 包むときだけ（版の上書き） |
| glob | 13.0.6 | BlueOak-1.0.0 | 包むときだけ（版の上書き） |

使用許諾は、`node_modules` の中の各部品の `package.json` から読みました。
