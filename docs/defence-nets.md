# Defence Nets

This note captures how defence nets are actually implemented in code.

## Terminology

- A defence net is the `METAL` project type in game logic.
- The persistent state is `StarSystem.hasDefensiveNet`.
- The client placement mode is named `DEFENSIVE_NET`, but the gameplay rule is driven by the metal project and the system flag.

Relevant code:

- `src/main/java/funorb/shatteredplans/game/GameState.java`
- `src/main/java/funorb/shatteredplans/game/ProjectOrder.java`
- `src/main/java/funorb/shatteredplans/map/StarSystem.java`

## Placement Rules

- A defence net order is a `ProjectOrder` with `type == GameState.ResourceType.METAL`.
- Server validation for the metal project checks:
  - projects are enabled
  - the order belongs to the issuing player
  - the target is non-null
  - the player has at least 5 metal research
  - the target is owned by that player
- The stock client adds stricter placement rules on top:
  - only owned systems are highlighted
  - systems that already have `hasDefensiveNet == true` are not selectable
- Normal client and server order-ingest paths keep only one metal project per player by replacing existing project orders of the same `(player, type)`.

Relevant code:

- `GameState.validateOrders()`
- `ProjectOrder.replaces()`
- `ClientGameSession.addOrder()`
- `ClientPlayer.addOrder()`

## Turn Timing

- Turn resolution order is:
  1. build fleets
  2. deploy defensive nets and stellar bombs
  3. resolve combat
  4. process collapses and retreats
  5. deploy Tannhauser links and terraforming
- All metal project orders set `target.hasDefensiveNet = true` before any stellar bombs are processed that turn.
- Metal research is then reset to `0` during the same project phase.

Relevant code:

- `GameState.simulateTurn()`
- `GameState.deployDefensiveNetsAndStellarBombs()`

## Combat Effect

- A defence net affects only the side that owns the system at combat start.
- Right before combat simulation, that side's combat fleet bucket is doubled.
- After combat simulation, that same bucket is halved back down.
- If the system still has an owner and that side still has fleets remaining, post-halving defenders are clamped to at least `1`.
- Incoming allied defenders are not doubled.
- Neutral defenders can also benefit, because neutral systems use their own combat bucket and the same `hasDefensiveNet` check.

Relevant code:

- `GameState.resolveCombatEngagement()`

## Stellar Bomb Interaction

- `GameOptions.destructibleDefenceNets` controls bomb behavior against netted systems.
- If `destructibleDefenceNets == true` and the target has a net:
  - the bomb removes the net
  - `0` garrison is killed
- Otherwise:
  - the bomb kills `(garrison + 1) / 2`
  - the net remains
- In both cases, the target loses all outgoing move orders.
- Preset defaults:
  - `CLASSIC_GAME_OPTIONS` uses `destructibleDefenceNets = false`
  - `STREAMLINED_GAME_OPTIONS` uses `destructibleDefenceNets = true`

Relevant code:

- `GameState.deployStellarBomb()`
- `GameOptions`

## Persistence

- A defence net lives on the `StarSystem` itself.
- Capture and disown paths do not clear `hasDefensiveNet`.
- In core gameplay code, the only direct clear is in `deployStellarBomb()` when destructible nets are enabled.
- Some maps can start with pre-seeded nets.

Implication:

- A captured system inherits any existing defence net unless it was removed by a destructible stellar bomb.

Relevant code:

- `GameState.captureSystem()`
- `GameState.disownSystem()`
- `StandardMapReader`
- `CaptureAndHoldMapReader`
- `DerelictsMapReader`
- `DerelictsMapGenerator`

## AI And UI

- AI treats a friendly netted system as cheaper to defend.
- AI treats an enemy netted system as more expensive to capture.
- AI can proactively spend the metal project on a threatened owned system.
- The renderer draws an animated net overlay for systems with `hasDefensiveNet == true`.
- Combat UI also marks the original defender specially when the system had a net at combat start.

Relevant code:

- `src/main/java/funorb/shatteredplans/game/ai/DefenseTask.java`
- `src/main/java/funorb/shatteredplans/game/ai/CaptureTask.java`
- `src/main/java/funorb/shatteredplans/game/ai/TaskAI.java`
- `src/main/java/funorb/shatteredplans/client/game/GameView.java`

## Notable Gaps

- Server validation does not reject a metal project targeting a system that already has a net; the stock client prevents that case.
- Because nets are deployed before stellar bombs in the same phase, a same-turn bomb can erase a same-turn net before combat if destructible nets are enabled.

