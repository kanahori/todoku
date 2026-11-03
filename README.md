# Todoku

Todoku ("it reaches" in Japanese) is a desktop app for Windows and macOS that lets blind and low-vision people use web apps through a simple screen of cards.

Built during Built with Claude: Japan 2026 (2026-11-02 to 2026-11-08), theme 2: "Things that should reach everyone". Work in progress.

日本語の説明は、このページの後半にあります。

## What it does

- Each web app (a learning site, a city website, ...) has a small config file that says, card by card, where to read and what to press.
- The app turns that config into a screen of plain buttons. A screen reader user moves with Tab and presses Enter or Space; the result is read out.
- `list` cards read every matching item with numbers, so content hidden in carousels or long pages becomes "4 items. Item 1: ...". Text in images is read from their `alt` text and `aria-label`, and slides that a carousel hides with `aria-hidden` are still read, because the person asked for them.
- When a web app changes its screen and a config line no longer matches, the app reports only which line fails. Claude then proposes a repaired selector from the page structure (with all text removed), and a person accepts or rejects each proposal.
- On the user's side, the repair can also happen on the spot: when a card cannot find what it should read or press, and an API key is set, the app asks Claude for that one card, tries the proposal on the page that is already open, and adopts it only if it looks right. The fix is kept locally (see "Automatic repair on the user's side" below) and can be undone from the card.

## Getting started (Windows)

- Requirements: Windows 10/11 (x64 or Arm64), Node.js 22.12 or later (tested with Node 26.13 on Windows 11 Arm64).
- Install dependencies: `npm ci`
  - Behind an HTTP proxy, the Electron binary download may fail with "fetch failed". Setting `NODE_USE_ENV_PROXY=1` (Node 24.5 or later) together with `HTTPS_PROXY` lets the download use the proxy.
- Start the app: `npm start`
  - The card screen opens. Each web app gets its own section; each card is a regular button that works with Tab, Enter and Space alone.
  - Results are announced to screen readers through a `role="status"` live region and also shown in the "Result" area.
- Run the tests:
  - `npm test` runs the unit tests with Node's built-in test runner.
  - `npm run smoke` runs the end-to-end checks inside Electron against the bundled practice pages in `test/fixtures/` (no network access).
  - `npm run ui:repair` opens the card screen with a fake repair model, so you can try the "accept / reject" form without an API key. Set `UI_REPAIR_AUTO=1` to run it unattended.
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
- `https_proxy` / `HTTPS_PROXY` (optional): passed to Electron as `--proxy-server`, so the app can reach outside pages from a network that needs a proxy. `no_proxy` / `NO_PROXY` (optional) is passed as `--proxy-bypass-list`. Without them, the app uses no proxy switches.

## Downloads

- When pressing a card starts a download in the web app window, the app saves the file to the user's Downloads folder under its original name (adding " (1)", " (2)", ... if the name is taken), or under the card's `saveAs` name if the config gives one, without a save dialog, and announces "「file name」をダウンロードのフォルダに保存しました。" (or that it could not be saved).

## How repair works (what is sent to Claude)

- "Check whether the screen has changed" tests every card's CSS selector against the current page, without clicking or reading anything.
- For each selector that no longer matches, the app collects only the page structure: element names, id, class, role, aria-* and data-* attributes, and nesting. All page text, links, image sources and form values are removed; elements that contain text are only marked "(has text)".
- Claude receives the failing lines (location in the config, card title, action, old selector) and that structure, and returns a proposed selector with a short reason (structured output).
- Each proposal is tried on the current page and shown with the number of matches. A person chooses "accept" or "reject" for each one; only accepted proposals are written to the config file, and the previous file is backed up to the app's user data folder (`config-backups`).

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
- The app opens the page, waits until the number of elements stops changing (at most 8 seconds), and collects the same text-free structure as for repairs (`looksTextFree` must pass). Claude receives only that structure: no page text, no URL, no page title. The structure is capped at 2,500 elements by `structure.js` and at 120,000 characters before sending; if it is cut, Claude is told so.
- Claude returns 4 to 8 cards in the config-file shape (structured output with zod): `role` (heading, main, list, notice, table, menu, search, button, link, other), `action` (`read` / `list` / `click`), `selector`, `container` (list cards only), `titleSelector` (the element whose text should become the card title) and a one-sentence reason.
- Card titles are made on this computer, never by Claude: the app reads the text of the `titleSelector` element (its `aria-label`, an image's `alt`, or a heading's text). For a `click` card without one, it uses the name of the element to press. If there is no usable text, the title is the role in Japanese with a number, such as "一覧 1". The deck name is the page's `<title>`, also used only on this computer.
- Each proposed card is tried on the page, and dropped if it does not fit: `read` must match an element with text, `list` at least one item, `click` exactly one element. Duplicates are dropped, and at most 8 cards are kept.
- The remaining cards are saved as a new config file in the app's user data folder (`generated/<id>.json`) and appear on the first screen at the next start too. While Claude works, the usual progress messages say how many seconds have passed. The whole process times out after 90 seconds. When done, the app opens the new deck and announces once "「{name}」のカードを{N}枚作りました。"; on failure it announces one sentence with the reason and shows the URL field again.
- The first card of a generated deck has two extra buttons: "設定ファイルとして書き出す（支援者向け）" writes the deck as `todoku-<id>.json` into the Downloads folder, so a supporter can check it and distribute it as a regular config file; "このカードの束を消す" deletes the deck and its local repairs.
- The first screen is now always shown, even when there is only one config, because it holds this entry point.

## Config file format (short)

- `id`, `name`, optional `description` (a description of the app, such as a source credit; read as the last item of the app's first card; keep URLs out of it, because screen readers read them almost character by character), optional `sourceUrl` (the `http(s)://` page of the source; the app's first card gets a "出典のページを開く" button that opens it in the default browser), `url` (`http(s)://...` or `fixture:<name>.html` for the practice pages), optional `login` (`selector` that indicates a login is needed, and `path` of the login page), and `cards`.
- Each card: `id`, `title`, `action` (`read` one element, `list` all matching items with numbers, `click`), `selector`, optional `path` (a page on the same site), `description`, for `click` cards only, `saveAs` (the file name for a download the card starts: `{date}` becomes the save date as yyyy-mm-dd, `{n}` the first unused number from 1; the original extension is added when the name has none), and, for `list` cards only, `container` (the selector of the element that holds the items: if it matches but no item does, the card says "0 items"; if it does not match either, the card says it cannot read. Without `container`, no items means "cannot read", because an empty list and a changed screen look the same).

## Bundled examples

- `cards/moodle-demo.json`: the public Moodle demo site (https://school.moodledemo.net/). The demo is shared by many people and is reset every hour; the app only opens it when a person presses a card.
- `cards/practice-city.json` and `test/fixtures/city-top.html`: a made-up city website ("Midori City") with an auto-rotating carousel and other common barriers. It is fictional and not based on any real city's site.
- `cards/practice-course.json` and `test/fixtures/course-before.html` / `course-after.html`: a made-up course page before and after a layout change, used to show the repair flow.
- All names in the practice pages are fictional.

## How Claude is used

- In the app: Claude (default `claude-opus-5-5`) proposes repaired selectors from the page structure, as described above.
- In the app: Claude also proposes a whole deck of cards for a page that has no config file, from the same text-free structure.
- In development: the app was built with Claude Code. One Claude Code session on Windows wrote most of the app and tested it with NVDA; another on macOS reviewed the changes, wrote this README and the private local configs, and checked names and personal data before each push.

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

- ウェブアプリごとに、どこを読む・何を押すかを書いた設定ファイルを持ち、それをふつうのボタンのカードの画面にします。画面読み上げソフトの利用者は、Tab で移り、Enter か Space で押すと、結果が読み上げられます。
- `list` のカードは、当たる項目を番号付きで全部読みます。自動で切り替わる画像の帯（カルーセル）の中の隠れたお知らせも、「4件あります。1件目: …」と読めます。文字が画像だけのお知らせは、画像の説明（alt）から読みます。
- ウェブアプリの画面が変わって設定ファイルの行が当たらなくなると、アプリはどの行が当たらないかだけを知らせます。Claude が、文字を全部落としたページの構造から直したセレクタの案を作り、人が案ごとに「採る／採らない」を選びます。
- 設定ファイルの無いページでも、カードを作れます。はじめの画面の「新しいページからカードを作る」で URL（http か https）を入れると、アプリがそのページを開き、文字を全部落としたページの作りだけを Claude に送ります。Claude はカードの束の案（4〜8枚）を返し、アプリはその案をページで試して、当たらないカードや中身の空のカードを落とします。カードの題と束の名前は、アプリが手元でページの見出し・aria-label・alt・title から作り、Claude には送りません。作った束はその機械の中に残り、次の起動でも一覧に出ます。束のはじめのカードのボタンで、支援者向けに設定ファイルとして書き出したり、束を消したりできます。待つのは長くて90秒です。
- 使う人の側でも、その場で直せます。カードが読む所・押す所を見つけられず、鍵（CARDS_ANTHROPIC_API_KEY）があるときは、いま開いているページの構造からそのカードの案だけを作り、ページで試して確からしいときだけ採ります。直しはその機械の中だけに残り、カードの中の「直す前に戻す」ボタンで戻せます。
- 動かし方・設定・使った部品は、上の英語の節をご覧ください。
- 練習のページ（みどり市・講座のページ）は作り物で、実在の自治体や人とは関係ありません。
