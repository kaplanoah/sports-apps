---
paths:
  - "apps/*/page/**"
  - "shared/page/**"
  - "worker/red-change.mjs"
  - "worker/red-change-styles.mjs"
  - ".github/workflows/ci.yml"
---

# Red changes

- A red change is one whose bugs no CI browser would show, since none touches,
  scrolls, layers, and draws as an iPhone does, or that touches what iOS has drawn wrong before: parts left undrawn by how layers and sheets stack.
  The root's `worker/red-change.mjs` finds it, and counts each of these as red:
  - The shared JavaScript: any change to the shared JavaScript that moves and draws the page,
    but not to its comments, blank lines, or formatting, which draw nothing.
    That JavaScript is, in `shared/page/`:
    - `sheet.js`, `sheet-reopen.js`, `slide-panels.js`, `sheet-swipe.js`, and `sheet-sections.js`
    - `side-swipe.js`, `bracket-standings.js`, `pill-thumb.js`, `tab-bar.js`, and `eased-redraw.js`
    - `show-last-drawn.js`, `season-header.js`, `rider-taps.js`, and `held-bar.js`
    - `day-strip.js`, `strip-slide.js`, `pull-to-refresh.js`, and `spring-scroll.js`
  - The shared stylesheets' layering declarations: a change to the sequence of the shared stylesheets' top-level statements,
    like `@layer` and `@import`, and declarations, under each selector and its at-rules,
    of a property that decides how parts layer, stack, scroll,
    take a touch, or show, whatever its value.
    - The shared stylesheets are `sheet.css`, `pager.css`,
      `chrome.css`, `team-sheet.css`, `game-cards.css`, and `day-strip.css`.
    - Those properties are any that gives a part a layer of its own, listed below, any `position`, `overflow` but `overflow-wrap`,
      `overscroll-behavior`, `scroll-snap`, `scroll-behavior`, `scroll-padding`, `scroll-margin`,
      `touch-action`, `-webkit-touch-callout`, `user-select`, `pointer-events`, `z-index`,
      `opacity`, `visibility`, `display`, `isolation`, `mix-blend-mode`, `container`, `offset`,
      `view-transition-name`, `-webkit-box-reflect`, or `zoom`.
    - A change in their fonts, colors, spacing, or sizes isn't red, since CI checks those,
      so a rule renamed, split, or merged that sets none of those properties isn't red.
  - What other stylesheets add: what any other stylesheet of a page adds that gives a part a layer of its own,
    or lifts it over others, or decides how it scrolls or takes a touch,
    and any top-level statement it adds or takes out.
    - What gives a part a layer of its own is `transform`,
      `translate`, `rotate`, `scale`, `perspective`, `backface-visibility`,
      `filter`, `backdrop-filter`, `mask`, `clip-path`, `will-change`,
      `animation`, `transition`, `contain`, `content-visibility`, or a fixed or sticky `position`.
    - What lifts it over others, or decides how it scrolls or takes a touch,
      is any of the shared stylesheets' properties above but `opacity`, `visibility`, and `display`,
      with a `position` only `absolute`, `fixed`, or sticky, and an `overflow` only when it isn't `visible`.
  - Custom properties: a custom property any stylesheet of a page changes, adds, or takes out that one of those declarations reads, itself or through another,
    and the `@property` rule that registers one.
  - Other JavaScript: a line a page's other JavaScript adds that does any of these:
    - writes one of those layer properties or a fixed or sticky `position` as CSS, or starts an animation
    - sets or clears what those other stylesheets would be red to add, in any of these ways:
      - by a property's name on a part's style or on one a script holds as `style`, as `style.zIndex = 5` does
      - with `setProperty` or `removeProperty`
      - in a style's object
      - in a style's whole text, through its `cssText`, the `style` itself, or `setAttribute("style", ...)` and `removeAttribute("style")`
    - sets or clears a custom property those declarations read
    - sets or clears a style property whose name a template, a variable in `setProperty` or `removeProperty`, or an index into `style` holds
    - creates a `dialog`, `style`, or `script` element
    - holds the markup below
  - Page HTML: a line an app's `page/*.html` adds or takes out that holds `<script`, `<style`, `<dialog`, or `popover`,
    or a `style=` that sets what one of those other stylesheets would be red to add, or a custom property those declarations read,
    or a `style=` whose value the gate can't read, as where a template fills it in whole.
    Any change to these parts of the page is red too:
    - the stylesheets it links, whose order sets the cascade, but not its other links, like a preload or an icon
    - its `viewport`, `apple-mobile-web-app-capable`, `mobile-web-app-capable`, and `apple-mobile-web-app-status-bar-style` metas,
      which fit it to the screen, open it from the Home Screen without the browser's bars, and color the phone's own
    - its inline scripts and styles, which take effect in the order the page holds them
  - Manifests: a change to the `display`, `display_override`, `orientation`, or `scope` an app's `page/*.webmanifest` gives,
    which open its Home Screen app without the browser's bars, turn it, and say which pages keep it so,
    or to a manifest the gate can't read.
  - Unreadable diffs: a diff the gate can't read.
- In a stylesheet, a `style=`, or a script, a declaration that reads a custom property,
  or a value a template or the script fills in, counts as if it held any value.
  A `transition`, or a `transition-property`, counts unless every property it names only repaints a part (`color`, `background`, `background-color`,
  `border-color` and each side's, `outline-color`, `box-shadow`, `text-decoration-color`, `fill`, `stroke`, or `caret-color`),
  so `none`, `all`, one that names none, or a keyword like `inherit` counts.
  That exception doesn't hold for one in a script's CSS text, as in its template or a string, or keyed in a style's object or keyframes,
  however its key is written.
  Such a one counts whatever it eases, since the script can add to it past where the gate reads it.
- A script, stylesheet, or page the gate can't read is red, and so is one whose diff hides its content, as a binary one's does, from a diff that shows every file's text whatever `.gitattributes` says.
  By design it can't see what a page's other stylesheets take out, or their `display` and `opacity` overriding a shared rule,
  nor a class that markup or a script adds that a shared stacking rule then reaches.
  The base's copy of the gate's code, on the Node and modules the base names, judges a pull request's files,
  so a change to the gate's code can't let the pull request's own red change through,
  and a change to the workflow's `gate`, `phone`, or `check` job is the review's to weigh, as a guard the root's `REVIEW.md` names.
  Tests are never red.
- The owner's phone is a red change's test.
  CI's `gate` holds one on its head's `phone` status, pending until its PR has the `phone-ok` label,
  added by the owner after the PR's last push.
  Main's rules require that status for a merge, so `check` passes on the PR's tests and review alone.
  `gate` holds the change itself whenever main's rules don't require that status, which its own step reads from GitHub,
  or when the pull request comes from a fork, whose token can't post it.
  So a fork's pull request has no `phone` status and merges only past main's rules while they require it (`.github/workflows/ci.yml`).
- If parts of a page ever stop drawing on the phone again, the first step is a phone restart and a Diagnostics report from settings, not a code change.
