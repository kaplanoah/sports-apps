---
paths:
  - "apps/*/page/**"
  - "shared/page/**"
  - "tests/type-roles.test.js"
  - "tests/shape-tokens.test.js"
  - "tests/icons.test.js"
  - "tests/browser/theme-layout.mjs"
  - "tests/browser/type-roles.mjs"
  - "tests/browser/tap-states.mjs"
  - "apps/*/tests/browser/themes.spec.mjs"
  - "apps/*/tests/browser/sheet-stack.spec.mjs"
  - "apps/*/tests/browser/role-looks.spec.mjs"
  - "apps/*/tests/browser/views.mjs"
  - "apps/wnba/tests/hardwood.test.js"
  - "tests/hover-color.test.js"
  - "tests/browser/contrast.mjs"
  - "tests/browser/stray-periods.mjs"
  - "tests/browser/never-shown-words.mjs"
---

# How the pages look

- A theme changes only colors, so each view lays out the same in each of an app's themes.
  A theme may also change a weight where its font keeps its width at every weight,
  as MLB's Ball sets a final's losing score a step lighter in Chivo Mono,
  to stand apart from the winner as much as its dim ink does in Night Game.
  A theme may also lift a part a pixel or two where its colors look off center otherwise,
  as MLB's bracket chips and their digits sit as each theme's set them by eye, which the root's `tests/browser/theme-layout.mjs` leaves out.
  The WNBA's `tests/browser/themes.spec.mjs` checks every view in Walnut against Maple,
  on a phone and a wide screen, with the root's `tests/browser/theme-layout.mjs`; a new view joins its list.
- Sheets look alike.
  Every sheet's top is a band, from `.sheet-page .sheet-top` in `shared/page/sheet.css`,
  never a list of sheets, as tall as what it holds: the WNBA's is the floor's color over the card's,
  ending in a line, with each title at the same height on every sheet and what goes with it, like a game's teams and score, in the band under it.
  A title holds its name and one line under it, and anything more, like a player's facts or hometown, goes in the band under the title,
  so the title and its close or back button, which holds the top of the title's row (`shared/page/chrome.css`), sit in one spot on every sheet and the band grows below them.
  Sheets, and a sheet's sections, slide side by side with the app's `--sheet-gap` of the sheet's color between them,
  each band's sides edged in its line while they move, so two bands never have to meet.
  Each app's `tests/browser/sheet-stack.spec.mjs` opens every sheet on the page and checks each top; a new sheet joins its list, or the test fails.
- Set every text in a type role from `shared/page/type.css`, whose top comment lists each role and what it sets,
  like `title` for the app's name, `body` for sentences, `detail` for short facts, and `label` for capitals.
  Each app's `:root` sets each role's size and weight for its own fonts, as `--type-<role>-size` and `--type-<role>-weight`,
  matched by eye so a role looks as big and as heavy in every app, and a new league sets its own.
  A rule that sets a role's size sets its weight from the same role,
  or a step from it where its text leads or recedes within the role, as `calc(var(--type-label-weight) - 100)`,
  and a heading's or label's letter spacing from `--type-heading-tracking` or `--type-label-tracking`.
  Every line height set by its text's size is a share of the app's `--leading`,
  which MLB's Libre Franklin sets a little apart, while one in pixels keeps its pixels.
  The root's `tests/type-roles.test.js` checks the stylesheets for each.
  The WNBA sets its words in Barlow and its teams, numbers, and the app's name in Barlow Condensed,
  which draws 8% larger to look as big as Barlow,
  and MLB sets its words in Libre Franklin and its numbers in Chivo Mono,
  which draws at 97.48% to look as big as Libre Franklin's words.
  A field's text is at `--type-field-size` (16px), since an iPhone zooms in on a smaller field when it's tapped,
  in a copy of its font whose `size-adjust` draws it at its role's size,
  as both apps' searches and Season pickers do, never a viewport that stops a pinch.
  The root's `tests/browser/type-roles.mjs` lists every shown text off its app's role sizes,
  or in a weight its font has no face for, and each app's browser tests check every view with it.
  Each role draws in one font and one case,
  and in a second only where the app's `tests/browser/role-looks.spec.mjs` names the text and why,
  like MLB's numbers in Chivo Mono and the WNBA Games list's dates in Barlow, as a wall calendar's.
  That spec walks the theme specs' views from the app's `tests/browser/views.mjs`,
  the gate, the Updates box, and the bracket before the playoff field is set,
  and fails on any look its tables don't name, and on any they name that nothing draws.
- Shape every corner with the shape tokens the shared stylesheets read from each app's `:root`:
  `--radius-card`, `--radius-chip`, `--radius-control` for buttons and fields,
  like each name in a pill, and `--radius-sheet` for a sheet on a wide screen,
  with `--held-bar-line` under a bar held at the top once something scrolls under it.
  A dot is round, a switch is round like the phone's own, an app icon keeps its own shape,
  as does MLB's seed lock, drawn for its place,
  and the floating tab bar, tinted in the app's own color, stays a capsule like the phone's own.
  Any other corner typed as a number, an SVG shape's `rx` or `ry` too, fails the root's `tests/shape-tokens.test.js`.
  In every app, a sheet and settings fill a phone's screen, square and without a shadow,
  and leave the page behind them as it is, closing with a caret at their top left,
  or, on a sheet opened from another, going back with an arrow in its place,
  each just the icon in the app's `--accent`, from `shared/page/sheet.css` and `chrome.css`.
  The WNBA's look is Hardwood, which the top comment of its `page/styles.css` states in full:
  - square corners
  - cards and outlined buttons `--raised` inside an `--edge`
  - a held bar that ends in a line and never fades
  - buttons in sentence case, the one that's on filled orange, like the list a pill shows,
    whose other names are plain words
  - orange and teal each with two jobs, named only in `:root` as the roles every rule uses:
    `--now` (what's happening now) and `--action` (where to tap) in orange,
    and `--structure` (what organizes the page) and `--result` (how something ended) in teal
  - everything else in ink, which its `tests/hardwood.test.js` checks
- Channel logos in `shared/page/networks/` come only from Wikimedia Commons files marked public domain or CC0, or from the repo's owner, since the repo is public.
  A logo that works on only one background gets a version for the other,
  made by turning its black parts the cream of team names on a dark page or its white parts dark, and named with `-dark` for the dark one.
- Icons come only from [Phosphor](https://phosphoricons.com), the apps' one icon set.
  Copy the icon's path from it at the weight its neighbors use,
  Light for the page's controls, like the tab bar and close buttons,
  and Regular in a line of text.
  Name the icon and weight in a comment where the code holds it, as `team-view.js` does for its caret-right.
  Never draw an icon by hand or take one from another set, but for those `HAND_DRAWN_ICONS` in the root's `tests/icons.test.js` lists,
  which fails on any other and on a Phosphor icon whose comment doesn't name it with its weight.
  An All-Star team's star isn't an icon but stands in for its dot (`shared/page/all-star.js`).
- Make every tap land on a button or a link.
  An iPhone hands the page a tap only where one is, whatever listens for it,
  so a page's listener never finds what was tapped from the row or card around a button.
  A row that opens wherever it's tapped has its button reach over it,
  as a game's row does (`shared/page/game-row.css`) and the WNBA bracket's team lines do.
  The standings do too, in a table, where Safari never lets a row hold what reaches over it,
  with the cell around the button and a clip around the table (`shared/page/row-button.css`).
  The root's `tests/browser/tap-states.mjs` lists each spot that shows a pointer where a tap lands on no button (`listTapsOffButtons`),
  and each app's browser tests check every view with it; a new view or sheet joins that list,
  and a test of a row's tap checks where a finger lands, with `document.elementFromPoint`, as well as what opens.
- Separate items in a line of facts with `joinWithSeparator` from `shared/page/html.js`; lint rejects a bullet or middle dot typed by hand.
- Tune a design on the real app, on a preview of its PR, with the tuning panel (`shared/page/tuning-panel.js`),
  in Safari: the Simulator, Mac Safari, or the phone.
  Tune it in a mockup only when the owner asks for one,
  or picks one the session offered for a round that isn't about exact pixels,
  built from `main`'s real stylesheets and markup and checked against production, as the `ship` skill's "The beta channel" says.
  A round names the CSS variables it tunes,
  and the values the owner copies back become fixed values in the code.
- A phone and a wide screen look the same, except where the width forces a difference.
- Things shown side by side for comparison share one scale, like two pitchers' speed lines.
- Desktop hover is a subtle change of text color only, to the app's `--ink-hover`: never an underline, border, or highlight,
  which the root's `tests/hover-color.test.js` checks.
- Readable before elegant.
  Text that's too small, light, or dim is a bug: check it against its type role,
  and against WCAG's AA contrast, 4.5 to 1.
  The root's `tests/browser/contrast.mjs` checks contrast wherever the browser tests check the type roles,
  once nothing is pressed or mid-transition, so a test of a pressed or hovered row's colors measures that on purpose.
  The WNBA's `tests/browser/themes.spec.mjs` checks it in both its themes.
- On the pages, text of one sentence or less, like a label, an empty view's note,
  or a setting's note, ends without a period.
  Text of two or more sentences,
  like a release note or a message that says what to do, ends with one,
  but for text that ends in a link, which ends without one, as the Home Screen app's note does.
  An outlet's own words keep their punctuation, in an element marked `data-quoted`.
  The root's `tests/browser/stray-periods.mjs` lists any shown text that breaks this,
  and each app's browser tests check every view with it, wherever they check the type roles.
- Each app's `page/js/league-words.js` holds what its fans call the things that differ by league,
  which shared code reads instead of typing its own (`shared/page/league-words.js`),
  and the words its pages never show, like another sport's.
  The root's `tests/browser/never-shown-words.mjs` lists any shown text that holds one,
  and each app's `page.spec.mjs` checks every view with it, wherever it checks the type roles.
- On the pages, write how fans talk, not a league's official or press words:
  the playoffs in every app, never the postseason or a berth,
  and a league's own word only where its fans say it too, like the World Series, Opening Day, and extra innings.
- Before pushing a change to how a page looks, screenshot every view it touches,
  in each of the app's themes, on a phone and a wide screen, and look at each one: a test checks only what it names.
  Look at a new view beside its siblings, like a new sheet beside the others, rather than on its own.
  Fix anything off, and name the views and themes you looked at in the PR's description.
