# Web Frontend Migration

## Goal

Replace the legacy Java client with a new web frontend under `src/app` while
keeping the original Java backend and game rules authoritative.

The new app should preserve the existing playable feature set:

- login/bootstrap
- tutorial and skirmish entry points
- multiplayer lobby browser
- room create/join/leave/invite/kick flows
- lobby and room chat
- spectator flow
- in-game map interaction and order entry
- diplomacy
- production and projects
- victory and stats panels
- resign and return-to-lobby flows

Current backend limitations should be preserved unless we explicitly implement
them:

- no persistent accounts
- unrated games only
- achievements are stubbed
- friends/ignore are not functional
- draw/rematch are not implemented
- private message / quick chat / report abuse are incomplete

## Source Of Truth

The existing Java client is not a thin UI. It currently owns major parts of the
play experience:

- menu flow and local single-player/tutorial control
- in-game interaction and rendering
- some multiplayer client-side state handling

The Java server already owns:

- login handshake
- lobby membership and room lifecycle
- room options
- multiplayer game state and turn progression
- AI turns for network sessions

For the web migration, the backend must become the source of truth for browser
state as well. We should avoid rebuilding a second game engine in TypeScript.

## Reference Direction

`stellcon` is a structural and visual reference, not a code transplant target.

Patterns to borrow:

- one top-level app shell that switches between lobby, room, game, overlays,
  and dialogs
- a board-first layout with compact side panels instead of route-heavy UI
- server-authoritative state updates over a live connection
- minimal copy, dense controls, and visually expressive panels

Patterns we will not copy directly:

- raw CSS architecture
- Socket.IO-specific protocol contracts
- its monorepo layout in full

We will translate the same ideas into:

- React + Vite
- Tailwind + a small design token layer
- an HTTP/SSE or WebSocket adapter from the Java backend

## Proposed Architecture

### Backend

Add a browser-facing adapter layer to the Java app:

- expose authenticated browser sessions
- expose lobby, room, and game snapshots
- accept browser actions for room control, chat, orders, diplomacy, and turn
  state
- publish live updates for lobby, room, chat, and game changes

Recommended shape:

- HTTP JSON endpoints for commands and bootstrap
- WebSocket stream for live updates

Why this shape:

- easier to host behind Coolify and reverse proxies
- simpler browser client than the legacy binary TCP protocol
- lower implementation overhead than a full custom browser packet stack

### Frontend

Create `src/app` as a standalone Vite app:

- React for app state and screen composition
- Tailwind for layout, tokens, and panel styling
- SVG/DOM board rendering with pan/zoom and layered overlays
- a single state machine for auth, lobby, room, game, spectate, and modal flow

Planned slices:

- `src/app/src/features/auth`
- `src/app/src/features/lobby`
- `src/app/src/features/room`
- `src/app/src/features/game`
- `src/app/src/features/chat`
- `src/app/src/features/tutorial`
- `src/app/src/shared`

## Migration Order

1. Stand up the frontend workspace and design system.
2. Add backend browser adapter and session model.
3. Implement auth/bootstrap and main shell.
4. Implement lobby browser, room flows, and chat.
5. Implement game board, HUD panels, and order entry.
6. Add tutorial/skirmish support through backend-backed or adapter-backed game
   session creation.
7. Add Docker Compose and Coolify-ready runtime wiring.
8. Verify end-to-end flows against the Java backend.

## Verification Targets

These flows must be manually verified before calling the migration complete:

- anonymous or lightweight username login reaches main menu
- tutorial starts and can be completed
- skirmish starts and ends normally
- lobby loads with players and rooms
- room creation and room option changes propagate
- invites and join requests work
- chat works in lobby and room/game contexts
- multiplayer game starts from a room
- spectator can attach to a started game
- move/build/project orders can be entered, changed, and submitted
- diplomacy offers and acceptances update both players
- turn advancement updates timers, order resolution, and victory state
- resignation and leave-room flows behave correctly

## Current Implementation

### Backend Adapter

The browser-facing adapter now exists under `src/main/java/funorb/shatteredplans/web`.

Implemented so far:

- `GET /api/health`
- `GET /api/session`
- `POST /api/session/login`
- `WS /ws` snapshot stream
- in-memory browser sessions and lightweight username login
- lobby presence, room summaries, room details, and chat snapshots
- room create/join/leave/start/invite/kick flows
- join-request accept/reject and invite cancel flows
- skirmish and tutorial launch through Java game rules
- spectator attach/detach
- in-game orders, diplomacy, resign, and end-turn commands
- board snapshots with systems, links, forces, pending orders, victory data,
  stats strings, and event log summaries

### Frontend

`src/app` now builds as a Vite + React + Tailwind app and is wired to the
backend snapshots instead of demo data.

Implemented so far:

- auth screen backed by `/api/session/login`
- always-on session WebSocket for live state updates
- lobby screen with:
  - room browser
  - lobby player list
  - lobby chat
  - tutorial launch
  - skirmish launch controls
- room screen with:
  - member roster
  - join requests
  - invitations
  - room option editing
  - start-game flow
  - room chat
- game screen with:
  - SVG board rendering
  - system selection
  - build orders
  - move arming and target selection
  - project placement
  - diplomacy controls
  - game chat
  - stats panel
  - victory panel
  - event log panel

### Deployment

Docker/Coolify packaging now exists:

- `Dockerfile.backend`
- `src/app/Dockerfile`
- `src/app/nginx.conf`
- `docker-compose.yml`

This uses:

- one Java backend container
- one nginx frontend container
- same-origin `/api` and `/ws` proxying from nginx to the backend

## Verified Build And Runtime Checks

These checks were completed in the working tree on 2026-03-21:

- Java compile: `docker run ... mvn -q -DskipTests compile`
- shaded jar package: `docker run ... mvn -q -DskipTests package`
- frontend production build: `npm run build` in `src/app`
- container builds: `docker compose build`
- proxy health check: `GET http://localhost/api/health` returned `{"ok":true}`
- websocket smoke test:
  - login
  - attach `/ws`
  - `createRoom`
  - snapshot changed from lobby to room
- multiplayer room smoke test:
  - owner created a room
  - second player requested to join
  - owner accepted the join request
  - both players entered the room
  - room owner started the game
  - both players entered the game
  - a spectator attached to the running room
- skirmish smoke test:
  - login
  - `createSkirmish`
  - snapshot contained a populated board
  - `endTurn`
  - turn number advanced
- tutorial smoke test:
  - login
  - `createTutorial`
  - snapshot entered a tutorial game session
- diplomacy and chat smoke test:
  - room chat propagated between players
  - alliance offer propagated to the second player
  - alliance acceptance updated both players
  - game chat propagated between players

## Open Risks

- tutorial behavior currently lives heavily in client-side Java code
- the current server is optimized for the legacy binary protocol, not browser
  snapshots
- some UI states in the old client are implicit and will need to be made
  explicit in the adapter model
- exact visual parity is not the goal, but mechanical parity is
- the browser tutorial currently boots a Java tutorial game session, but it
  does not yet reproduce the original scripted overlay/tutorial UI flow from
  the legacy client
- we have runtime smoke coverage, but not exhaustive browser automation for
  every room/game control path yet
