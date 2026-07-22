# Agent Instructions

## Do Not Start or Functionally Test the App Without Permission

- Never start, serve, preview, or otherwise run the application unless the user explicitly asks in the current conversation to run it or to test its functionality.
- This includes direct and indirect launch paths such as `npm start`, `npm run dev`, `npm run preview`, the repository's `start` script, local server scripts, Docker/Compose services, browser automation, and any command that launches the app or binds its ports.
- Never open the app in a new browser tab or window, navigate or refresh an existing app tab, or use browser/computer automation against it unless the user explicitly asks in the current conversation. This applies even when opening the app would ordinarily be part of testing or verification.
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

## Preserve the Running Docker Configuration During Builds

- A static host build such as `npm run build` is allowed without additional permission. A Docker/Compose rebuild, container recreation, restart, or invocation of `./start` is not a static build and remains prohibited unless the user explicitly asks for it.
- The running Docker app bind-mounts this repository and serves `web/dist`, so a host build replaces the bundle used by the user's app. Before building, preserve the active theme from the existing Docker container configuration or from the user's stated launch configuration. Determine it with read-only inspection only; do not open the app, refresh a tab, restart a container, or infer a theme from visual appearance.
- Build the Docker-served bundle with both `VITE_VISUAL_FM_THEME` set to the active theme and `VITE_VISUAL_VISUAL_PATCH_STORAGE=local`. The latter is required so `SV` saves to the local patch library instead of downloading a file.
- Do not run an unconfigured `npm run build` while the Docker app is running, because it compiles the default theme and storage mode into `web/dist`. Use the equivalent of `VITE_VISUAL_FM_THEME="$ACTIVE_THEME" VITE_VISUAL_VISUAL_PATCH_STORAGE=local npm run build`.
- If the active theme cannot be determined reliably through read-only inspection or prior user context, do not build. Run another non-mutating check such as `npm run typecheck`, and tell the user that the build was skipped to avoid replacing their active theme.
- A build does not grant permission to refresh the user's tab or functionally test the result. Tell the user that an ordinary refresh is required and let them perform it.

## Keep the README in Sync

- For every task, review the completed change before handoff and decide whether `README.md` now needs to be added to or amended. Make any required README changes as part of the same task.
- Give special attention to user-visible UI behavior and workflows, all keyboard shortcuts and modifier-key gestures, and any added, removed, renamed, or behaviorally changed node type.
- When a node changes, keep both its description and its signature (input and output port names) accurate. Include changes to dynamic ports, renamed ports, defaults, modes, or other controls when they affect how a user connects or operates the node.
- Also update setup, build, configuration, persistence, file-format, compiler, and architecture documentation whenever the corresponding behavior changes.
- Do not edit the README merely to create churn. If no documentation is affected, leave it unchanged and state at handoff that README impact was checked.
