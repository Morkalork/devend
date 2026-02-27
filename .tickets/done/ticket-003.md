# TICKET-003: Introduce Achievements

## Description
There will be a new feature, Achievements, which will give the user awards for long term playing. A player will be able to see their Achievements in a new Achievement screen, accessible
through a button on the main screen underneath the Achievements button. The 10 closest achievements should be visible and their targets should be clear (together with current status). 
An example achievement:

Name: Fence fighter
Requirement: Create 100 fences
Current status: ??? fences created
Bonus: Fence base generation speed increased by 10%

A progress bar will also visualize the players current status vis-a-vi the target requirement.

All achievements will be placed in a file called achievements.yml in the /public folder for future configuration.

## Requirements
- [ ] Create achievements.yml file in the /public folder
- [ ] Read the achievements.yml file on app load and apply bonuses
- [ ] The achievements view is available from the start menu
- [ ] The achievements view list all achievements, also depicting the current status for each achievements and how close/far away the user is away from achieving it
- [ ] Only show the closest 10 achievements (closest in the sense of reaching it), meaning this can change between rounds

## Acceptance Criteria
- Users can view achievements from the start menu
- Achievements can be configured through achievements.yml
- Only the closest 10 achievements to achieve are shown in the list (or less, if there are less than 10 achievements left available)
- Achievements are applied to the game

// Usage: `/plan Read .tickets/backlog/001.md`