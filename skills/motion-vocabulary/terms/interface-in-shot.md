# Interface in shot

Use authentic product states and assets. A screen interaction should show its cause and its result.

- **Cursor click** (`cursor-click`) - A visible cursor lands on a control and triggers its next state.
  - HF: `cursor-click-ripple` synchronizes cursor, target press and ripple on one timeline.
  - Remotion: Interpolate cursor travel, then render press and state change at the click frame.
- **Press feedback** (`press-feedback`) - A control compresses on contact and returns to its resting shape.
  - HF: `press-release-spring` runs a short press followed by a bounded recovery.
  - Remotion: Interpolate downscale, then use a local `spring()` for recovery after release.
- **Cursor drag** (`cursor-drag`) - A pointer moves a grabbed item to a destination that accepts it.
  - HF: `cursor-drag` locks the dragged ghost to the pointer until the drop pose.
  - Remotion: Derive cursor and dragged item positions from one frame progress, then snap to the destination.
- **Control-target sync** (`control-target-sync`) - A changed control and its affected result update during the same action.
  - HF: `control-target-sync` drives both surfaces from one GSAP tween or threshold state.
  - Remotion: Derive control and target states from the same frame progress and value.
- **Panel expansion** (`panel-expansion`) - A closed control grows into a panel while keeping its anchored edge.
  - HF: `anchored-layout-expand` animates a scale or mask proxy with matching content movement.
  - Remotion: Interpolate a masked panel reveal and translate adjacent content from the same progress.
- **UI shared element** (`ui-shared-element`) - One interface item changes function while its visual anchor stays recognizable.
  - HF: `card-morph-anchor` carries the container's apparent bounds and radius through the change.
  - Remotion: Keep one anchor asset and interpolate its bounds, radius and contents across state frames.
- **Progress state** (`progress-state`) - A loading indicator shows work before a visible result replaces it.
  - HF: Schedule discrete status changes with `discrete-text-sequence` and fill with `stat-bars-and-fills`.
  - Remotion: Drive the indicator from frame thresholds and reveal the result at the final state.
- **Chart scrub** (`chart-scrub`) - A moving read head shows values at successive positions on an existing chart.
  - HF: `chart-scrub-readout` binds marker, tracking line and tooltip to one driver.
  - Remotion: Calculate marker and readout from the same frame-derived position and sourced data array.
- **Page scroll** (`page-scroll`) - The view travels through one long interface to reveal later content.
  - HF: `3d-page-scroll` moves internal page content inside a held surface.
  - Remotion: Interpolate the page's vertical offset inside a clipped window or device.
- **Result reveal** (`result-reveal`) - A user action resolves into evidence that the product completed the task.
  - HF: Use one timeline label for the trigger and a later label for the result; `dynamic-content-sequencing` can stage the details.
  - Remotion: Sequence action, progress and result by frame while keeping the result's claim tied to real assets.
