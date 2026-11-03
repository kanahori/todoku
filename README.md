# Todoku

Todoku ("it reaches" in Japanese) is a desktop app for Windows and macOS that lets blind and low-vision people use web apps through a simple screen of cards.

Built during Built with Claude: Japan 2026 (2026-11-02 to 2026-11-08), theme 2: "Things that should reach everyone". Work in progress.

日本語の説明は、このページの後半にあります。

## What Claude does, in short

- **Repairs cards when a site changes.** When a card no longer finds what it should read or press, Claude proposes a new CSS selector for that one card. The app tries it on the open page and keeps it only if it fits; the fix stays on this computer and can be undone.
- **Makes a deck of cards for a page that has no config file.** Claude proposes 4 to 8 cards from the page structure. The app tests every proposal on the page, drops the ones that do not fit, makes the titles itself, and adds one card per section of the main text.
- **Claude never sees the page's words.** Only a text-free structure is sent (element names, id, class, role, aria-* and data-* attributes, nesting). No page text, URL, page title, link or form value is sent to Claude. Reading the page aloud is done locally, not by Claude.
- Without an API key everything except these two features still works.

## What it does

- Each web app (a learning site, a city website, ...) has a small config file that says, card by card, where to read and what to press.
- The app turns that config into a deck of cards. Up and Down Arrow move between cards, Enter or Space opens a card or reads the web app, Up and Down Arrow then read the result item by item, and Esc goes back. Tab stops only on the current card. The web app itself stays in a separate window behind the card screen and never takes the keyboard focus (except for a login, when the user asks for it).
- `list` cards read every matching item with numbers, so content hidden in carousels or long pages becomes "4 items. Item 1: ...". Text in images is read from their `alt` text and `aria-label`, and slides that a carousel hides with `aria-hidden` are still read, because the person asked for them.
- When a web app changes its screen and a config line no longer matches, the app reports only which line fails. With an API key, the repair happens on the spot (see "Automatic repair on the user's side"); a supporter can then write the fix into the config file to distribute it.
- When a page is still being written (for example a chat reply that appears bit by bit), the card waits until it is finished; see "Pages that are still being written".

## Getting started (Windows)

- Requirements: Windows 10/11 (x64 or Arm64), Node.js 22.12 or later (tested with Node 26.13 on Windows 11 Arm64).
- Install dependencies: `npm ci`
  - Behind an HTTP proxy, the Electron binary download may fail with "fetch failed". Setting `NODE_USE_ENV_PROXY=1` (Node 24.5 or later) together with `HTTPS_PROXY` lets the download use the proxy.
- Start the app: `npm start`
  - The first screen ("Todoku") opens. Its cards are the app's introduction, display settings, search, one card per web app, and "新しいページからカードを作る".
  - Results are announced through a `role="status"` live region (errors through `role="alert"`), and the result items are put inside the card so they can be read again with the arrow keys.
- Run the tests:
  - `npm test` runs the unit tests with Node's built-in test runner.
  - `npm run smoke` runs the end-to-end checks inside Electron against the bundled practice pages in `test/fixtures/` (no network access).
  - `npm run ui:repair` was for the "accept / reject" proposal form of the earlier screen. That form is being rebuilt for the card screen, so for now the script only prints that and exits.
  - `npm run smoke`, `npm run ui:repair` and `npm run real:tsukuba` keep their windows hidden and never take the keyboard focus from the app in front (on macOS they also stay out of the Dock), so they are safe to run while someone is typing. Add `-- --show-windows` to show the windows (for example, to look at the `ui:repair` screen).
  - `npm run smoke:windows` runs the same smoke checks with the windows shown, so the focus checks also cover the real window manager. Its windows come to the front, so run it only when nobody is using the computer.
- Build Windows installers: `npm run dist:win`
  - Produces an installer (`dist/Todoku Setup 1.0.0.exe`) and a portable build (`dist/Todoku 1.0.0.exe`), each containing both x64 and Arm64.
  - The builds are not code-signed, so Windows SmartScreen may show an "unknown publisher" warning.
  - Config files inside the packaged app are read-only. To let the app write repaired selectors, keep your config files in the local folder (`CARDS_LOCAL_DIR`) or run from a working copy with `npm start`.

## Getting started (macOS)

- Requirements: macOS on Apple silicon, Node.js 22.12 or later (tested with Node 22.19).
- `npm ci`, then `npm start`. `npm test` and `npm run smoke` work the same way as on Windows.
- If the Electron binary download fails behind a proxy, download `electron-v<version>-darwin-arm64.zip` and `SHASUMS256.txt` from the Electron releases page, check the SHA-256, extract the zip into `node_modules/electron/dist`, and write `Electron.app/Contents/MacOS/Electron` into `node_modules/electron/path.txt`.
- Build a macOS disk image: `npm run dist:mac` produces `dist/Todoku-1.0.0-arm64.dmg` (Apple silicon). It is not signed or notarized, so macOS warns that the developer cannot be verified; open it from the context menu (Open) the first time.
  - Behind a proxy, point `ELECTRON_CACHE` to a folder that already holds the Electron zip and `SHASUMS256.txt`.

## Configuration (environment variables)

- `CARDS_LOCAL_DIR` (optional): a folder of extra config files (`*.json`) that are loaded after the bundled `cards/`. Use it for sites whose configs you do not want to publish. A config whose `id` duplicates one already loaded is skipped and reported.
- `CARDS_ANTHROPIC_API_KEY` (optional): the Anthropic API key used to ask Claude for repaired selectors. Without it, the app says it cannot make repair proposals; everything else works. The app deliberately does not read `ANTHROPIC_API_KEY`, so that the key used by the app stays separate from other tools on the same machine.
- `CARDS_REPAIR_MODEL` (optional): the Claude model used for repair proposals. Default: `claude-opus-5-5`.
- `https_proxy` / `HTTPS_PROXY` (optional): passed to Electron as `--proxy-server`, so the app can reach outside pages from a network that needs a proxy. `no_proxy` / `NO_PROXY` (optional) is passed as `--proxy-bypass-list`. Without them, the app uses no proxy switches and follows the system proxy settings. At startup the app tries to reach the proxy it would use (from these variables or from the system settings, 2-second timeout); if it cannot (for example, off campus while the system proxy still points to the campus proxy), it connects directly inside the app only, without changing the system settings, and writes one line to `log.txt` in the app's user data folder.

## Downloads

- When pressing a card starts a download in the web app window, the app saves the file to the user's Downloads folder under its original name (adding " (1)", " (2)", ... if the name is taken), or under the card's `saveAs` name if the config gives one, without a save dialog, and announces "「file name」をダウンロードのフォルダに保存しました。" (or that it could not be saved).

## What is sent to Claude

- The app collects only the page structure: element names, id, class, role, aria-* and data-* attributes, and nesting. All page text, links, image sources and form values are removed; elements that contain text are only marked "(has text)". Before sending, the app checks again that the structure contains no page text (`looksTextFree`) and sends nothing if it does.
- For a repair, Claude also receives the failing line (location in the config, card title, action, old selector) and returns a proposed selector with a short reason (structured output).
- A supporter decides what is distributed: a fix is written into a config file only from the supporter card (see below), and the previous file is backed up to the app's user data folder (`config-backups`). The earlier screen also had a form to check every card and accept or reject proposals one by one; it is being rebuilt for the card screen.

## Automatic repair on the user's side

- Trigger: a `read`, `list` or `click` card finds nothing on the page ("cannot read"; an empty list found through `container` is "0 items", not a failure). Login screens, broken config syntax and pages that fail to open are not repaired.
- The app collects the structure of the page that is already open (no reload), checks that it contains no page text, and sends Claude only the failing line and that structure. It waits at most 45 seconds; while waiting, the usual "reading" progress messages say that the card is being repaired.
- The proposal is tried on the current page and adopted only if it looks right: `read` matches at least one element with some text, `list` matches at least one item, `click` matches exactly one element.
- After adopting, a `read` / `list` card is read again and the screen reader hears "画面が変わったので、読む所を直しました。" once. A `click` card is not pressed again; the user is told that it was fixed and decides whether to press it.
- The fix applies only on this computer. The bundled `cards/*.json` are not changed. Each app gets an override file in the app's user data folder (`repairs/<app id>.json`) with the card, the original and the new selector, Claude's reason and the time, so the fix still works after a restart. If a newer config file changes that selector, the override is ignored.
- Undo: the repaired card has a "直す前に戻す" button. Supporters can open the "自動で直した所（支援者向け）" card at the end of the app's cards to see every automatic fix, write one into the config file (the same way as accepted proposals, with a backup in `config-backups`), or undo it.
- After "直す前に戻す", focus moves to the first item inside the same card, so one Esc returns to the card and does not leave the deck.
- Without an API key, or when Claude fails, times out or the proposal does not look right, the card says "cannot read" as before and ends with one more sentence with a short reason, e.g. "自動で直すこともできませんでした（Claude の鍵がありません）。" (other reasons: "時間内に終わりませんでした", "確かな案がありませんでした", "Claude が案を作れませんでした"). The click card adds the same sentence to its "could not press" message.

## Cards for a page without a config file

- The first screen ("Todoku") has a card "新しいページからカードを作る" (make cards from a new page). Pressing Enter or Space on it moves to a labeled URL field ("ページのURL（http か https で始まるもの）"). Only `http://` and `https://` addresses are accepted. Enter in the field, or the "作り始める" button, starts.
- The app opens the page, waits until the number of elements, the amount of text and the loaded resources stop changing (at most 15 seconds), and collects the same text-free structure as for repairs (`looksTextFree` must pass). Claude receives only that structure: no page text, no URL, no page title. The structure is capped at 2,500 elements by `structure.js` and at 120,000 characters before sending; if it is cut, Claude is told so.
- Claude returns 4 to 8 cards in the config-file shape (structured output with zod): `role` (heading, main, list, notice, table, menu, search, button, link, other), `action` (`read` / `list` / `click`), `selector`, `container` (list cards only), `titleSelector` (the element whose text should become the card title) and a one-sentence reason.
- Card titles are made on this computer, never by Claude: the app uses the `titleSelector` element only when it belongs to the card's place (inside it, or the heading just before it), and otherwise the heading, `aria-labelledby`, landmark label or first short text of the place. A `click` card is titled with the name of the element to press, made clearer when it is one word ("市町村選択" becomes "市町村を選ぶ", a place name becomes "地域を選ぶ（…）", "検索" becomes "サイト内を検索する"). Long titles are cut at a word boundary. The deck name is the page's `<title>` without the site name part, also used only on this computer.
- Each proposed card is tried on the page, and dropped if it does not fit: `read` must match an element with text, `list` at least one item, `click` exactly one element. The app also drops cards it cannot title, `click` cards whose element has no name, cards whose content is a single word or just a heading line, breadcrumbs, and duplicates; a table of contents becomes one card "目次を読む". At most 8 of Claude's cards are kept.
- Guards that do not depend on Claude: the largest table or list (3 or more rows) of the main area always gets a card, even when Claude did not propose it; up to 6 cards are added, one per heading section of the main text (`until` reads from the heading to the next heading; sections under 40 characters are skipped); and the cards are ordered by their position on the page. Claude's proposals vary from run to run (the model, `claude-opus-5-5`, does not accept a `temperature` setting), so these guards keep the deck the same: in the smoke test, two runs with different proposals for the same practice page give the same deck.
- The remaining cards are saved as a new config file in the app's user data folder (`generated/<id>.json`) and appear on the first screen at the next start too. While Claude works, the usual progress messages say how many seconds have passed. The whole process times out after 90 seconds. When done, the app opens the new deck and announces once "「{name}」のカードを{N}枚作りました。"; on failure it announces one sentence with the reason and shows the URL field again.
- The first card of a generated deck has two extra buttons: "設定ファイルとして書き出す（支援者向け）" writes the deck as `todoku-<id>.json` into the Downloads folder, so a supporter can check it and distribute it as a regular config file; "このカードの束を消す" deletes the deck and its local repairs.
- The first screen is now always shown, even when there is only one config, because it holds this entry point.

## Pages that are still being written

- While the element a card reads, or an element around or inside it, has `aria-busy="true"` (for example a chat reply that is being written), the card waits until it is removed, up to its usual waiting time (8 seconds).
- If it is still being written after that, the card reads what is there and says so: "「{title}」を読みました。まだ書いている途中です。", with one more item in the card: "まだ書いている途中でした。ここまでを読みました。もう一度読むと、続きが読めます。"
- Pages that do not mark this with `aria-busy` are read as they are at that moment.

## Display settings and search

- The second card on the first screen is "表示設定" (display settings), the same three settings as the shared card-page guide of the course materials. Normally it shows one button, "表示設定を開く"; Enter or Space opens and closes the settings. Readability: "標準" / "ゆったり" (wider letter, word and line spacing, one column). "1列リフロー表示" on or off (item headings and contents in one column, no maximum width). Colors: "標準（配色変更なし）" / "高コントラスト（白地）" / "高コントラスト（黒地）". "表示設定を標準に戻す" resets the three.
- Each change is announced once in one sentence, e.g. "配色を「高コントラスト（黒地）」にしました。", and the button text itself says the state ("（選択中）", "：選択中", "1列リフロー表示: 有効").
- Text size: Ctrl (macOS: Command) with plus, minus or 0. The app handles these keys itself because the window has no menu, and announces the new size once ("文字の大きさを110%にしました。"). "表示設定を標準に戻す" does not change the text size.
- The settings and the text size are saved in the app's user data folder (`settings.json`) and applied before the cards are built at the next start. Unknown values fall back to the standard. When the OS forces colors (Windows High Contrast), the OS colors win.
- Contrast: text at least 7:1 and lines at least 3:1 in all three color schemes, including focused items and selected buttons. `test/settings.test.js` reads the colors from `style.css`, measures every pair, and checks the minimum written at the top of `index.html`.
- The third card, "カードを探す", searches the titles and descriptions of the cards of all apps. Results appear right after it, one card per app, headed with the app name and the count; apps without results get no card. The total is announced once after typing stops ("3件見つかりました。", or "見つかりませんでした。別の言い方でお試しください。"). Esc in the field returns to the search card, and Down Arrow moves to the first result card (Enter in the field also jumps there). Each "「{title}」へ移る" button opens that app's deck on that card; Esc comes back to the result card. Matching ignores full/half width, upper/lower case and hiragana/katakana; spaces mean "all of these words".

## Config file format (short)

- `id`, `name`, optional `description` (a description of the app, such as a source credit; read as the last item of the app's first card; keep URLs out of it, because screen readers read them almost character by character), optional `sourceUrl` (the `http(s)://` page of the source; the app's first card gets a "出典のページを開く" button that opens it in the default browser), `url` (`http(s)://...` or `fixture:<name>.html` for the practice pages), optional `login` (`selector` that indicates a login is needed, and `path` of the login page), and `cards`.
- Each card: `id`, `title`, `action` (`read` one element, `list` all matching items with numbers, `click`), `selector`, optional `path` (a page on the same site), `description`, for `click` cards only, `saveAs` (the file name for a download the card starts: `{date}` becomes the save date as yyyy-mm-dd, `{n}` the first unused number from 1; the original extension is added when the name has none), and, for `list` cards only, `container` (the selector of the element that holds the items: if it matches but no item does, the card says "0 items"; if it does not match either, the card says it cannot read. Without `container`, no items means "cannot read", because an empty list and a changed screen look the same). Also for `list` cards only, `dateSelector` (the date element inside each item: when the page shows only the day, the app reads the year, month and day written in that element's `datetime` or `id`, such as `2026-11-06` or `calendar_list_2026_11_6`, says the date as "11月6日", and waits until such dated items appear; when the date element is outside the item, for example one row per day with several events, the app looks for it in the item's row and puts the date and the weekday before each item), `tagSelector` (category labels inside each item, read after the title in brackets), and `itemTarget` (what to read when the user presses Enter on one item of the list: `label`, the name used in announcements such as "返事", and at least one of `closest` (go up from the item to this element), `next` (then the first following sibling that matches) and `find` (then this element inside it). The result opens as one card, "3件目の返事", and Esc twice returns to the same item. Example: in the practice chat, `{ "label": "返事", "closest": "li.turn", "next": "li.ai", "find": ".body" }` reads the reply to the selected question). For `read` cards only, `until` (a selector: the card reads the matched element and the sibling elements after it, up to the first one that matches `until`; cards that Claude makes for each section of the main text use it to read from a heading to the next heading).

## Bundled examples

- `cards/moodle-demo.json`: the public Moodle demo site (https://school.moodledemo.net/). The demo is shared by many people and is reset every hour; the app only opens it when a person presses a card.
- `cards/tsukuba-city.json`: the official website of Tsukuba City (https://www.city.tsukuba.lg.jp/), a real city site. Cards read the emergency information, the new pages, the notices, this month's events (from the event calendar page), every slide of the large rotating banner and of the pickup banner (the copies a carousel makes for looping are skipped), and the life-situation links. There is no card for the site search: the search box is an embedded search service, and Todoku cards cannot type text yet. The app's first card says "出典：つくば市公式ウェブサイト。" and has a button that opens the official site (`sourceUrl`). The app opens the city's pages in its own window and reads the text as it is; it does not change the pages and does not put them in a frame. `npm run real:tsukuba` checks every card and the automatic repair (with a fake model and `test/tsukuba-city-old-line-for-test.json`, a copy with one deliberately outdated selector) against the real site; it loads the site three times, so run it by hand, not in a loop.
- `cards/jma-forecast.json`, `cards/jma-daily.json`, `cards/jma-obsdl.json`: pages of the Japan Meteorological Agency (forecast for Tokyo, daily past weather data, and the past weather data download form, with click cards for each step of the form).
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

- `npm test`: 107 tests, 102 passed, 5 skipped (the Electron-only scripts), 0 failed.
- `npm run smoke`: 143 checks, 143 passed, against the practice pages only.
- `npm run real:tsukuba`: 13 checks, 13 passed, against the real Tsukuba City site.
- Measured on macOS on 2026-11-04, at the commit that added `itemTarget`.

## Future

- A browser for people who use the web by voice: the goal is that any page can be reached, not only the sites someone has written a config file for. Making cards for a new page and repairing them on the spot are the first steps.
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

Todoku（とどく）は、視覚に障害のある方が、カードの簡単な画面からウェブアプリを使えるようにする、Windows と macOS のアプリです。Built with Claude: Japan 2026（2026年11月2日〜8日）の期間中に作りました。テーマ2「本来、誰にでも届くべきもの」に当たります。開発中です。

Claude がしていること（まとめ）

- サイトの画面が変わってカードが当たらなくなったとき、そのカードの直しの案を作ります。アプリが開いているページで試し、合うときだけ採ります。直しはその機械の中だけに残り、戻せます。
- 設定ファイルの無いページでは、カードの束の案（4〜8枚）を作ります。アプリが案を一枚ずつページで試して合わないものを落とし、題を手元で作り、本文の見出しごとの節のカードを足します。
- Claude に送るのは、文字を全部落としたページの作りだけです。ページの文字・URL・題・リンク・入力した値は送りません。ページを読み上げるのは、Claude ではなくアプリです。
- 鍵（CARDS_ANTHROPIC_API_KEY）が無くても、この二つのほかは全部使えます。

- ウェブアプリごとに、どこを読む・何を押すかを書いた設定ファイルを持ち、それをカードの束の画面にします。上下の矢印でカードを移り、Enter か Space でカードを開いて読み、結果は上下の矢印で一件ずつ読めます。Esc で戻ります。ウェブアプリの窓は、カードの画面の後ろの別の窓にあり、焦点を取りません（ログインのときだけ、使う人が前に出せます）。
- `list` のカードは、当たる項目を番号付きで全部読みます。自動で切り替わる画像の帯（カルーセル）の中の隠れたお知らせも、「4件あります。1件目: …」と読めます。文字が画像だけのお知らせは、画像の説明（alt）から読みます。
- ウェブアプリの画面が変わって設定ファイルの行が当たらなくなると、アプリはどの行が当たらないかだけを知らせます。鍵があれば、その場で直します（下の「使う人の側でも」）。直しを設定ファイルに書いて配るかは、支援者が「自動で直した所（支援者向け）」のカードで決めます。前の画面にあった、全部のカードを点検して案ごとに「採る／採らない」を選ぶ欄は、カードの画面に作り直している途中です。
- 設定ファイルの無いページでも、カードを作れます。はじめの画面の「新しいページからカードを作る」で URL（http か https）を入れると、アプリがそのページを開き、文字を全部落としたページの作りだけを Claude に送ります。Claude はカードの束の案（4〜8枚）を返し、アプリはその案をページで試して、当たらないカードや中身の空のカードを落とします。カードの題と束の名前は、アプリが手元でページの見出し・aria-label・alt・title から作り、Claude には送りません。題を作れないカード、名前の無いボタン、中身が一語か見出し一行だけのカード、パンくずは作らず、目次は「目次を読む」の一枚にまとめます。本文の主な表・一覧（3行以上）は、Claude の案に無くても必ず一枚作り、本文の見出しごとの節を読むカード（6枚まで）を足し、ページの上からの順に並べます。Claude の案は作るたびに変わるので、これらの守りで同じ束になるようにしています。作った束はその機械の中に残り、次の起動でも一覧に出ます。束のはじめのカードのボタンで、支援者向けに設定ファイルとして書き出したり、束を消したりできます。待つのは長くて90秒です。
- 使う人の側でも、その場で直せます。カードが読む所・押す所を見つけられず、鍵（CARDS_ANTHROPIC_API_KEY）があるときは、いま開いているページの構造からそのカードの案だけを作り、ページで試して確からしいときだけ採ります。直しはその機械の中だけに残り、カードの中の「直す前に戻す」ボタンで戻せます。
- はじめの画面の二枚目は「表示設定」、三枚目は「カードを探す」です。表示設定は、授業の教材のカード型ページと同じ三つ（読みやすさの「標準」「ゆったり」、1列リフロー表示、配色の「標準（配色変更なし）」「高コントラスト（白地）」「高コントラスト（黒地）」）です。変えると一文で一度だけ知らせ、次の起動でも残ります。文字の大きさは、Ctrlキー（macOSではCommandキー）とプラス・マイナス・0で変えます。「カードを探す」は、全部のアプリのカードを題と説明から探し、アプリごとに見つかったカードを並べて、見つかった数を知らせます。
- 一覧のカードに `itemTarget` を書くと、一件を選んで Enter キーを押したときに、その一件に結び付いた所（チャットの質問への返事など）を読めます。「3件目の返事」の一枚のカードで開き、Esc を二度押すと、一覧のその一件に戻ります。作り物のチャットの「自分の質問を全部読む」で使っています。
- 書いている途中のページ（少しずつ描かれるチャットの返事など）は、読む所に aria-busy="true" が付いている間、書き終わるのを待って読みます（8秒まで）。待っても終わらなければ、そこまでを読み、「まだ書いている途中です。」と知らせます。aria-busy を付けないページは、そのときの文を読みます。
- 試しを Electron で走らせる間（`npm run smoke` など）は、窓を画面に出さず、前のアプリから焦点を奪いません。
- 起動のとき、使うプロキシの入口に届くかを2秒で試し、届かなければ、OS の設定は変えずにアプリの中だけ直に繋ぎます。
- 動かし方・設定・使った部品・試しの数は、上の英語の節をご覧ください。
- 同梱の例に、本物のつくば市公式ウェブサイト（https://www.city.tsukuba.lg.jp/ ）の設定ファイル（`cards/tsukuba-city.json`）があります。緊急情報・新着情報・お知らせ・今月のイベント情報（イベントカレンダーのページから）・大きな画像のお知らせとピックアップの全部（切り替えのために作られた写しは読みません）・くらしの情報（こんなときは）を読めます。サイト内の検索は、検索の欄が外の検索サービスの部品で、Todoku のカードはまだ文字を入れられないので、カードにしていません。はじめのカードで「出典：つくば市公式ウェブサイト。」と読み、公式サイトを開くボタン（`sourceUrl`）が付きます。アプリは市のページを自分の窓で開き、書いてあるとおりに読むだけで、ページを書き換えたり、フレームの中に入れたりはしません。`npm run real:tsukuba` で、本物のサイトで全部のカードと自動の直し（偽の Claude と、古い行を一つ含む写し `test/tsukuba-city-old-line-for-test.json` を使う）を確かめられます。サイトを3回読み込むので、手で一度ずつ動かしてください。
- 練習のページ（みどり市・講座のページ・ことのはチャット）は作り物で、実在の自治体・サービス・人とは関係ありません。
- これから（Future）: どんなページにも届く、音声で使う人のためのブラウザを目指しています。設定ファイルの無いページからカードを作ることと、その場で直すことは、その最初の一歩です。チャットの画面でやり取りを遡ったり追いかけたりする形は、作り物のチャットの画面でだけ試しました。本物のチャットのサービスには当てていません。各社の利用規約が、画面への自動の手段でのアクセスを制限しており、支援技術のための例外が書かれていないためです。
