# Agent Instructions

## Do Not Start or Functionally Test the App Without Permission

- Never start, serve, preview, or otherwise run the application unless the user explicitly asks in the current conversation to run it or to test its functionality.
- This includes direct and indirect launch paths such as `npm start`, `npm run dev`, `npm run preview`, the repository's `start` script, local server scripts, Docker/Compose services, browser automation, and any command that launches the app or binds its ports.
- Do not assume that a running app or server belongs to the agent. Do not stop, restart, replace, or reconfigure an existing process unless the user explicitly asks.
- Do not perform smoke, integration, end-to-end, browser, audio, or other functional/runtime tests unless the user explicitly asks to test functionality.
- After making changes, validate only with non-running checks that do not launch the app, such as builds, TypeScript typechecks, linting, formatting checks, or static compilation checks.
- Report which non-running checks passed, then hand the changes back to the user for functional testing.
- If a requested validation command would start the app or could interfere with an existing instance, do not run it; explain that it was skipped under this instruction.
- At every implementation handoff, tell the user how to make the change visible and test it. Choose the applicable case explicitly:
  1. **Already applied:** the running development app should receive the change immediately (for example through hot reload); tell the user what to inspect or exercise.
  2. **Refresh required:** the user must refresh the existing app; say whether an ordinary refresh is sufficient and then give the functional check.
  3. **Rebuild and restart required:** the user must rebuild and start the app again; name the relevant build/start commands when known, then give the functional check.
- If more than one case applies to different parts of a change, separate them clearly. Never carry out the refresh, restart, app launch, or functional test yourself unless the user explicitly asks.

## Keep the README in Sync

- For every task, review the completed change before handoff and decide whether `README.md` now needs to be added to or amended. Make any required README changes as part of the same task.
- Give special attention to user-visible UI behavior and workflows, all keyboard shortcuts and modifier-key gestures, and any added, removed, renamed, or behaviorally changed node type.
- When a node changes, keep both its description and its signature (input and output port names) accurate. Include changes to dynamic ports, renamed ports, defaults, modes, or other controls when they affect how a user connects or operates the node.
- Also update setup, build, configuration, persistence, file-format, compiler, and architecture documentation whenever the corresponding behavior changes.
- Do not edit the README merely to create churn. If no documentation is affected, leave it unchanged and state at handoff that README impact was checked.
