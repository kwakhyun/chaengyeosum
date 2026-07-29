# Design QA — 홈 기능 배경 이미지 카드

## Evidence

- Source visual truth: user-attached `스크린샷 2026-07-29 오전 11.02.58.png`
- Source pixels: 738 × 688 px, focused crop of the Home toolbox section
- Implementation screenshot: `/private/tmp/chaengyeosum-home-background-cards.png`
- Implementation pixels: 1280 × 1064 px
- CSS viewport: 1280 × 720 px, full-page capture of the existing 480 px mobile app surface
- State: Home, one saved outing, live crowd summary loaded, light theme
- Density normalization: the source is a focused crop at a different capture scale, so the cards were compared structurally and visually rather than by raw pixel coordinates. Both source and implementation were placed in the same comparison input.

## Full-view Comparison

The implementation preserves the source hierarchy—one wide Places card followed by two equal feature cards—but replaces the small isolated icons and mostly empty white surfaces with full-bleed, app-owned background imagery. The hero and toolbox now read as one summer visual system while the recent-outing section remains visually subordinate.

The primary card labels, live crowd summary, saved-outing count, and chevrons remain visible and interactive. Fixed bottom navigation does not overlap the full-page card content.

## Focused Region Comparison

- Places and Weather: a bright Han River picnic image reinforces the live place/weather concept. A pale left-side overlay keeps dark title and population text readable.
- Personality Test: a purple-blue 3D summer character creates the strongest playful/shareable card. The dark lower overlay preserves white text contrast.
- My Outings: a blue checklist picnic bag, calendar, and tickets communicate planning and saved outings. The lower-left copy remains clear on the aqua negative space.
- Image crops: all three subjects remain recognizable at the 148–168 px card heights; no faces, bags, or key weather cues are clipped beyond recognition.

## Findings

No actionable P0, P1, or P2 issue remains.

## Required Fidelity Surfaces

- Fonts and typography: the existing Home heading, 17–19 px feature titles, small dynamic summaries, weights, and letter spacing remain consistent. No text wraps or truncates unexpectedly at the tested width.
- Spacing and layout rhythm: the original 2-column toolbox grid, 10 px gaps, 24 px radii, and vertical content order are preserved. Increasing the image-card height adds visual weight without displacing the primary hero.
- Colors and visual tokens: generated imagery uses the established blue, white, aqua, lavender, and coral palette. Real image overlays map to existing dark/light text tokens and maintain usable contrast.
- Image quality and asset fidelity: three unique 1024 px WebP assets are sharp, correctly cropped, and compressed to 46–77 KB. No placeholder, emoji, CSS illustration, handcrafted SVG, or stretched source image is used.
- Copy and content: feature names and dynamic status copy are unchanged, so stronger imagery does not reduce comprehension or remove useful live information.

## Interaction and Accessibility Checks

- Verified semantic feature buttons and accessible names remain intact.
- Opened the Personality Test card and returned through Home navigation.
- Verified decorative background images have empty alt text and do not duplicate button labels.
- Verified chevrons, fixed navigation, and card tap targets remain available.
- Checked local preview output during the flow; no runtime error was reported.

## Comparison History

- Pass 1: generated assets were not visible because the Sites preview owns a separate public asset directory.
- Fix: copied the optimized WebP assets into both app and Sites public asset directories.
- Pass 2 evidence: `/private/tmp/chaengyeosum-home-background-cards.png`; all three images render and no P0/P1/P2 issue remains.

## Follow-up Polish

- P3: if the Home section later gains longer localized copy, the two square cards may need a slightly stronger bottom overlay rather than smaller text.

## Implementation Checklist

- [x] Create a distinct Places and Weather background
- [x] Create a distinct Personality Test background
- [x] Create a distinct My Outings background
- [x] Preserve dynamic labels and feature navigation
- [x] Optimize and copy assets into both app hosting surfaces
- [x] Verify the full Home flow in the browser

final result: passed
