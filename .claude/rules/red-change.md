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
  The root's `worker/red-change.mjs` finds it: any change to the shared JavaScript that moves and draws the page (`sheet.js`,
  `sheet-reopen.js`, `slide-panels.js`, `sheet-swipe.js`, `sheet-sections.js`,
  `side-swipe.js`, `bracket-standings.js`, `pill-thumb.js`, `tab-bar.js`, `eased-redraw.js`,
  `show-last-drawn.js`, `season-header.js`, `rider-taps.js`, `held-bar.js`,
  `day-strip.js`, `strip-slide.js`, `pull-to-refresh.js`, and `spring-scroll.js` in `shared/page/`),
  but not to its comments, blank lines, or formatting, which draw nothing;
  a change to the sequence of its shared stylesheets' (`sheet.css`, `pager.css`,
  `chrome.css`, `team-sheet.css`, `game-cards.css`, and `day-strip.css`) top-level statements,
  like `@layer` and `@import`, and declarations, under each selector and its at-rules,
  of a property that decides how parts layer, stack, scroll,
  take a touch, or show, whatever its value (any below, any `position`, `overflow` but `overflow-wrap`,
  `overscroll-behavior`, `scroll-snap`, `scroll-behavior`, `scroll-padding`, `scroll-margin`,
  `touch-action`, `-webkit-touch-callout`, `user-select`, `pointer-events`, `z-index`,
  `opacity`, `visibility`, `display`, `isolation`, `mix-blend-mode`, `container`, `offset`,
  `view-transition-name`, `-webkit-box-reflect`, or `zoom`),
  but not in their fonts, colors, spacing, or sizes, which CI checks,
  so a rule renamed, split, or merged that sets none of those isn't red;
  what any other stylesheet of a page adds that gives a part a layer of its own (`transform`,
  `translate`, `rotate`, `scale`, `perspective`, `backface-visibility`,
  `filter`, `backdrop-filter`, `mask`, `clip-path`, `will-change`,
  `animation`, `transition`, `contain`, `content-visibility`, or a fixed or sticky `position`),
  or lifts it over others, or decides how it scrolls or takes a touch (any of those but `opacity`, `visibility`, and `display`,
  with a `position` only `absolute`, `fixed`, or sticky, and an `overflow` only when it isn't `visible`),
  and any top-level statement it adds or takes out;
  a custom property any stylesheet of a page changes, adds, or takes out that one of those declarations reads, itself or through another,
  and the `@property` rule that registers one;
  a line a page's other JavaScript adds that writes one of those layer properties or a fixed or sticky `position` as CSS, or starts an animation,
  that sets or clears what those other stylesheets would be red to add, by a property's name on a part's style or on one a script holds as `style`, as `style.zIndex = 5` does,
  with `setProperty` or `removeProperty`, in a style's object,
  or in a style's whole text, through its `cssText`, the `style` itself, or `setAttribute("style", ...)` and `removeAttribute("style")`,
  or a custom property those declarations read, or a style property whose name a template, a variable in `setProperty` or `removeProperty`, or an index into `style` holds,
  that creates a `dialog`, `style`, or `script` element, or that holds the markup below;
  a line an app's `page/*.html` adds or takes out that holds `<script`, `<style`, `<dialog`, or `popover`,
  or a `style=` that sets what one of those other stylesheets would be red to add, or a custom property those declarations read,
  or whose value the gate can't read, as where a template fills it in whole,
  or any change to the stylesheets it links, whose order sets the cascade, but not its other links, like a preload or an icon,
  to its `viewport`, `apple-mobile-web-app-capable`, `mobile-web-app-capable`, and `apple-mobile-web-app-status-bar-style` metas,
  which fit it to the screen, open it from the Home Screen without the browser's bars, and color the phone's own,
  or to its inline scripts and styles, which take effect in the order the page holds them;
  a change to the `display`, `display_override`, `orientation`, or `scope` an app's `page/*.webmanifest` gives,
  which open its Home Screen app without the browser's bars, turn it, and say which pages keep it so,
  or to a manifest the gate can't read;
  and a diff the gate can't read.
  In a stylesheet, a `style=`, or a script, a declaration that reads a custom property, or a value a template or the script fills in, counts as if it held any value,
  and a `transition`, or a `transition-property`, counts unless every property it names only repaints a part (`color`, `background`, `background-color`,
  `border-color` and each side's, `outline-color`, `box-shadow`, `text-decoration-color`, `fill`, `stroke`, or `caret-color`),
  so `none`, `all`, one that names none, or a keyword like `inherit` counts,
  but for one in a script's CSS text, as in its template or a string, or keyed in a style's object or keyframes,
  however its key is written, which counts whatever it eases,
  since the script can add to it past where the gate reads it.
  A script, stylesheet, or page the gate can't read is red, and so is one whose diff hides its content, as a binary one's does, from a diff that shows every file's text whatever `.gitattributes` says.
  By design it can't see what a page's other stylesheets take out, or their `display` and `opacity` overriding a shared rule,
  nor a class that markup or a script adds that a shared stacking rule then reaches.
  The base's copy of the gate's code, on the Node and modules the base names, judges a pull request's files,
  so a change to the gate's code can't let the pull request's own red change through,
  and a change to the workflow's `gate`, `phone`, or `check` job is the review's to weigh, as a guard the root's `REVIEW.md` names.
  Tests are never red.
  The owner's phone is a red change's test, and CI's `gate` holds one on its head's `phone` status, pending until its PR has the `phone-ok` label,
  added by the owner after the PR's last push,
  which main's rules require for a merge, so `check` passes on the PR's tests and review alone,
  and holds the change itself whenever main's rules don't require that status, which its own step reads from GitHub,
  or the pull request comes from a fork, whose token can't post it,
  so a fork's pull request has no `phone` status and merges only past main's rules while they require it (`.github/workflows/ci.yml`).
- If parts of a page ever stop drawing on the phone again, the first step is a phone restart and a Diagnostics report from settings, not a code change.
