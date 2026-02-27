# TICKET-000: Add proper interactive tutorial

## Description
The current tutorial is only a poorly drawn hand showing how to draw a line. I want a clearer tutorial that looks like the rest of the design and that clearly shows the game play. Both how to generate fences, but also how the top menu works, as well as the bottom statistics. And that there is a store in between each map that allows for you to level up. This is not one big tutorial, this is a tutorial that shows when a specific, new elements becomes relevant for the user. Such as when entering the store for the first time, or the Augmentation workshop.

## Requirements
- [ ] Remove current tutorial
- [ ] Add a tutorial that highlights the top bar and its purpose. This tutorial part can be closed by clicking/tapping anywhere.
- [ ] Add another step in the tutorial that highlights the bottom bar and its purpose. This tutorial part can be closed by clicking/tapping anywhere.
- [ ] Add a third step in the tutorial for showing how to draw a fence. Only remove this part of the tutorial, once the user has drawn a fence. This tutorial shows immediately after the above tutorials have been shown.
- [ ] When the user enters the store for the first time, show a tutorial that explains how the store works, how Over Time works and that the effects of purchases will show in the bottom bar on the next map.
- [ ] When the user enters the Augmentation workshop for the first time, show a tutorial that explains how it works.
- [ ] Once any tutorial is completed, the tutorial that has been shown will not show again until you re-enable it from the options screen. This re-enable option will re-enable ALL tutorials, so it's not selective.


## Technical Notes
- The tutorial needs to work as an overlay
- It needs to be clear that clicking anywhere (except for the fence-drawing tutorial) closes the tutorial (or takes you to the next step)
- The tutorial should make it clear there is a Tutorial-section on the main screen, available on the Tutorial-button
- All tutorials need to cover the entire viewport

## Acceptance Criteria
- The user can learn the basic mechanics of the game
- The user understands how the store works
- The user only has to see the tutorial once
- The user can re-run the tutorial by re-enabling it from the options screen