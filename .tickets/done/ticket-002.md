# TICKET-002: tutorial improvements

## Description
The tutorial must do a better job highlighting what it's currently focusing on. What ever it focus on (such as the top bar, bottom bar, store etc), it must highlight it clearly.

## Requirements
- [ ] The currently focused area should have a glowing dropshadow (use the currently active color, green by default)
- [ ] Add a graphical arrow pointing towards the area being focused on. Not enormous, but at least 200px in size.

## Technical Notes
- There are some remains of an earlier attempt left, they are not working very well and should be purged as part of this

## Acceptance Criteria
- User can clearly see the focused area, without any confusion

## Notes
The rest of the app must be fade out when the tutorial is focusing on something. This is currently done well by darkening it with an overlay, but showing the current area of focus isn't.
The problem is that since the app design is already dark, it is not immediately clear which part is highlighted, since the difference isn't immediately clear.