package funorb.shatteredplans.web;

import com.fasterxml.jackson.databind.JsonNode;
import funorb.client.UserIdLoginCredentials;
import funorb.shatteredplans.StringConstants;
import funorb.shatteredplans.client.game.BuildFleetsEvent;
import funorb.shatteredplans.client.game.CombatEngagementLog;
import funorb.shatteredplans.client.game.CombatLogEvent;
import funorb.shatteredplans.client.game.FleetRetreatEvent;
import funorb.shatteredplans.client.game.PlayerStats;
import funorb.shatteredplans.client.game.StellarBombEvent;
import funorb.shatteredplans.client.game.TurnEventLog;
import funorb.shatteredplans.game.BuildFleetsOrder;
import funorb.shatteredplans.game.Force;
import funorb.shatteredplans.game.GameOptions;
import funorb.shatteredplans.game.GameSession;
import funorb.shatteredplans.game.GameState;
import funorb.shatteredplans.game.MoveFleetsOrder;
import funorb.shatteredplans.game.Player;
import funorb.shatteredplans.game.ProjectOrder;
import funorb.shatteredplans.game.ai.AI;
import funorb.shatteredplans.game.ai.TaskAI;
import funorb.shatteredplans.map.StarSystem;
import funorb.shatteredplans.map.generator.TutorialMapGenerator;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

public final class WebState {
  private static final int MAX_CHAT_MESSAGES = 200;
  private static final int SOLO_PLAYER_COUNT = 4;

  private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);
  private final Map<String, BrowserSession> sessions = new LinkedHashMap<>();
  private final Map<Integer, WebRoom> rooms = new LinkedHashMap<>();
  private final Deque<ChatEntry> lobbyMessages = new ArrayDeque<>();
  private int nextRoomId = 1;

  public SessionSnapshot snapshot(final @Nullable String sessionId) {
    synchronized (this) {
      return this.snapshotForLocked(sessionId == null ? null : this.sessions.get(sessionId), List.of());
    }
  }

  public SessionSnapshot login(final @Nullable String requestedDisplayName) {
    final BrowserSession session;
    synchronized (this) {
      final String displayName = this.allocateDisplayName(this.normalizeDisplayName(requestedDisplayName));
      final long userId = UserIdLoginCredentials.encodeUsername(displayName);
      session = new BrowserSession(UUID.randomUUID().toString(), userId, displayName);
      this.sessions.put(session.id, session);
    }
    this.flushAll();
    return this.snapshot(session.id);
  }

  public List<Push> attachSocket(final String sessionId, final Sink sink) {
    synchronized (this) {
      final BrowserSession session = this.requireSessionLocked(sessionId);
      session.sink = sink;
      session.connected = true;
      return this.buildPushesLocked();
    }
  }

  public List<Push> detachSocket(final @Nullable String sessionId) {
    synchronized (this) {
      if (sessionId == null) {
        return List.of();
      }
      final BrowserSession session = this.sessions.get(sessionId);
      if (session == null) {
        return List.of();
      }
      session.connected = false;
      session.sink = null;
      return this.buildPushesLocked();
    }
  }

  public List<Push> handleCommand(final String sessionId, final String type, final JsonNode payload) {
    synchronized (this) {
      final BrowserSession session = this.requireSessionLocked(sessionId);
      switch (type) {
        case "createRoom" -> this.createRoomLocked(session);
        case "joinRoom" -> this.joinRoomLocked(session, payload.path("roomId").asInt());
        case "leaveRoom" -> this.leaveRoomLocked(session);
        case "updateRoomOptions" -> this.updateRoomOptionsLocked(session, payload);
        case "invitePlayer" -> this.invitePlayerLocked(session, payload.path("userId").asLong());
        case "acceptJoinRequest" -> this.acceptJoinRequestLocked(session, payload.path("userId").asLong());
        case "rejectJoinRequest" -> this.rejectJoinRequestLocked(session, payload.path("userId").asLong());
        case "cancelInvitation" -> this.cancelInvitationLocked(session, payload.path("userId").asLong());
        case "kickPlayer" -> this.kickPlayerLocked(session, payload.path("userId").asLong());
        case "startGame" -> this.startRoomGameLocked(session);
        case "spectateRoom" -> this.spectateRoomLocked(session, payload.path("roomId").asInt());
        case "leaveGame" -> this.leaveGameLocked(session);
        case "sendChat" -> this.sendChatLocked(session, payload.path("scope").asText("lobby"), payload.path("message").asText(""));
        case "createSkirmish" -> this.createSoloGameLocked(session, "skirmish", payload);
        case "createTutorial" -> this.createSoloGameLocked(session, "tutorial", payload);
        case "setOrders" -> this.setOrdersLocked(session, payload);
        case "endTurn" -> this.endTurnLocked(session);
        case "cancelEndTurn" -> this.cancelEndTurnLocked(session);
        case "resign" -> this.resignLocked(session);
        case "rematch" -> this.rematchLocked(session);
        case "requestAlliance" -> this.requestAllianceLocked(session, payload.path("targetPlayerIndex").asInt(-1));
        case "acceptAlliance" -> this.acceptAllianceLocked(session, payload.path("targetPlayerIndex").asInt(-1));
        default -> throw new IllegalStateException("Unknown command: " + type);
      }
      return this.buildPushesLocked();
    }
  }

  public void shutdown() {
    synchronized (this) {
      this.rooms.values().forEach(room -> {
        if (room.game != null) {
          room.game.shutdown();
        }
      });
      this.sessions.values().forEach(session -> {
        if (session.soloGame != null) {
          session.soloGame.shutdown();
          session.soloGame = null;
        }
      });
    }
    this.scheduler.shutdownNow();
  }

  private void flushAll() {
    final List<Push> pushes;
    synchronized (this) {
      pushes = this.buildPushesLocked();
    }
    pushes.forEach(push -> push.sink.send(push.snapshot));
  }

  private BrowserSession requireSessionLocked(final String sessionId) {
    final BrowserSession session = this.sessions.get(sessionId);
    if (session == null) {
      throw new IllegalStateException("Unknown session.");
    }
    return session;
  }

  private void createRoomLocked(final BrowserSession session) {
    this.ensureNoActiveSoloGameLocked(session);
    this.clearSpectatorGameLocked(session);
    if (session.room != null) {
      return;
    }

    final WebRoom room = new WebRoom(this.nextRoomId++, session);
    room.members.add(session);
    session.room = room;
    this.rooms.put(room.id, room);
    session.spectatingGame = null;
  }

  private void joinRoomLocked(final BrowserSession session, final int roomId) {
    final WebRoom room = this.requireRoomLocked(roomId);
    this.ensureNoActiveSoloGameLocked(session);
    this.clearSpectatorGameLocked(session);
    if (session.room == room) {
      return;
    }
    if (session.room != null) {
      this.leaveRoomLocked(session);
    }
    if (room.game != null && !room.game.isFinished()) {
      throw new IllegalStateException("That room is already in a running game.");
    }
    if (room.members.size() >= room.options.maxHumanPlayers) {
      throw new IllegalStateException("That room is full.");
    }

    if (room.options.accessMode == AccessMode.OPEN || room.invitations.contains(session)) {
      room.invitations.remove(session);
      room.joinRequests.remove(session);
      room.members.add(session);
      session.room = room;
      session.spectatingGame = null;
    } else {
      room.joinRequests.add(session);
    }
  }

  private void acceptJoinRequestLocked(final BrowserSession session, final long userId) {
    final WebRoom room = this.requireOwnedRoomLocked(session);
    final BrowserSession target = this.findSessionByUserIdLocked(userId)
        .orElseThrow(() -> new IllegalStateException("Player not found."));

    if (!room.joinRequests.remove(target)) {
      return;
    }
    if (room.members.size() >= room.options.maxHumanPlayers) {
      throw new IllegalStateException("That room is full.");
    }

    this.ensureNoActiveSoloGameLocked(target);
    this.clearSpectatorGameLocked(target);
    if (target.room != null && target.room != room) {
      this.leaveRoomLocked(target);
    }

    room.members.add(target);
    target.room = room;
  }

  private void rejectJoinRequestLocked(final BrowserSession session, final long userId) {
    final WebRoom room = this.requireOwnedRoomLocked(session);
    final BrowserSession target = this.findSessionByUserIdLocked(userId)
        .orElseThrow(() -> new IllegalStateException("Player not found."));
    room.joinRequests.remove(target);
  }

  private void cancelInvitationLocked(final BrowserSession session, final long userId) {
    final WebRoom room = this.requireOwnedRoomLocked(session);
    final BrowserSession target = this.findSessionByUserIdLocked(userId)
        .orElseThrow(() -> new IllegalStateException("Player not found."));
    room.invitations.remove(target);
  }

  private void leaveRoomLocked(final BrowserSession session) {
    final WebRoom room = session.room;
    if (room == null) {
      return;
    }

    if (room.game != null && !room.game.isFinished()) {
      room.game.handleHumanDeparture(session, true);
    }

    room.invitations.remove(session);
    room.joinRequests.remove(session);
    room.members.remove(session);
    session.room = null;

    if (room.owner == session) {
      room.owner = room.members.isEmpty() ? null : room.members.get(0);
    }

    if (room.members.isEmpty()) {
      if (room.game != null) {
        room.game.shutdown();
      }
      this.rooms.remove(room.id);
    }
  }

  private void updateRoomOptionsLocked(final BrowserSession session, final JsonNode payload) {
    final WebRoom room = this.requireOwnedRoomLocked(session);
    if (room.game != null && !room.game.isFinished()) {
      throw new IllegalStateException("Cannot change room options after the game starts.");
    }

    room.options.maxHumanPlayers = clamp(payload.path("maxHumanPlayers").asInt(room.options.maxHumanPlayers), 2, 6);
    room.options.aiPlayers = clamp(payload.path("aiPlayers").asInt(room.options.aiPlayers), 0, 5);
    room.options.turnLengthIndex = clamp(payload.path("turnLengthIndex").asInt(room.options.turnLengthIndex), 0, 6);
    room.options.classicRuleset = payload.path("classicRuleset").asBoolean(room.options.classicRuleset);
    room.options.allowSpectate = payload.path("allowSpectate").asBoolean(room.options.allowSpectate);
    room.options.gameType = parseGameType(payload.path("gameType").asText(room.options.gameType.name()), room.options.gameType);
    room.options.galaxySize = parseGalaxySize(payload.path("galaxySize").asText(room.options.galaxySize.name()), room.options.galaxySize);
    room.options.accessMode = parseAccessMode(payload.path("accessMode").asText(room.options.accessMode.name()), room.options.accessMode);
  }

  private void invitePlayerLocked(final BrowserSession session, final long userId) {
    final WebRoom room = this.requireOwnedRoomLocked(session);
    final BrowserSession target = this.findSessionByUserIdLocked(userId)
        .orElseThrow(() -> new IllegalStateException("Player not found."));

    if (room.members.contains(target)) {
      return;
    }
    if (room.joinRequests.remove(target)) {
      if (room.members.size() >= room.options.maxHumanPlayers) {
        throw new IllegalStateException("The room is already full.");
      }
      room.members.add(target);
      target.room = room;
      target.spectatingGame = null;
      return;
    }
    room.invitations.add(target);
  }

  private void kickPlayerLocked(final BrowserSession session, final long userId) {
    final WebRoom room = this.requireOwnedRoomLocked(session);
    final BrowserSession target = this.findSessionByUserIdLocked(userId)
        .orElseThrow(() -> new IllegalStateException("Player not found."));

    if (target == room.owner) {
      throw new IllegalStateException("The room owner cannot be kicked.");
    }
    if (room.joinRequests.remove(target) || room.invitations.remove(target)) {
      return;
    }
    if (room.members.remove(target)) {
      if (room.game != null && !room.game.isFinished()) {
        room.game.handleHumanDeparture(target, true);
      }
      target.room = null;
    }
  }

  private void startRoomGameLocked(final BrowserSession session) {
    final WebRoom room = this.requireOwnedRoomLocked(session);
    if (room.game != null && !room.game.isFinished()) {
      return;
    }

    final int requestedAiPlayers = room.members.size() == 1 ? Math.max(1, room.options.aiPlayers) : room.options.aiPlayers;
    final int aiPlayers = clamp(
        requestedAiPlayers,
        0,
        Math.max(0, StringConstants.EMPIRE_NAMES.length - room.members.size()));
    room.startedAt = Instant.now().toEpochMilli();
    room.finalElapsedTimeMillis = -1L;
    room.game = WebGameSession.createRoomGame(room, aiPlayers, this.scheduler, this::handleTurnTimer);
  }

  private void spectateRoomLocked(final BrowserSession session, final int roomId) {
    final WebRoom room = this.requireRoomLocked(roomId);
    if (room.game == null) {
      throw new IllegalStateException("That room is not running.");
    }
    if (!room.options.allowSpectate) {
      throw new IllegalStateException("Spectating is disabled for that room.");
    }

    if (session.spectatingGame != null) {
      session.spectatingGame.removeSpectator(session);
    }
    session.spectatingGame = room.game;
    room.game.addSpectator(session);
  }

  private void leaveGameLocked(final BrowserSession session) {
    this.clearSpectatorGameLocked(session);

    if (session.soloGame != null) {
      session.soloGame.shutdown();
      session.soloGame = null;
    }
  }

  private void createSoloGameLocked(final BrowserSession session, final String kind, final JsonNode payload) {
    this.leaveGameLocked(session);
    if (session.room != null) {
      this.leaveRoomLocked(session);
    }

    final GameState.GameType gameType = parseGameType(payload.path("gameType").asText("CONQUEST"), GameState.GameType.CONQUEST);
    final GameState.GalaxySize galaxySize = parseGalaxySize(
        payload.path("galaxySize").asText(GameState.GalaxySize.MEDIUM.name()),
        GameState.GalaxySize.MEDIUM);
    final boolean classicRuleset = payload.path("classicRuleset").asBoolean(true);
    final int aiPlayers = clamp(payload.path("aiPlayers").asInt(SOLO_PLAYER_COUNT - 1), 1, 5);
    final int turnLengthIndex = clamp(payload.path("turnLengthIndex").asInt(0), 0, 6);
    final GameOptions options = classicRuleset ? GameOptions.CLASSIC_GAME_OPTIONS : GameOptions.STREAMLINED_GAME_OPTIONS;

    session.soloGame = WebGameSession.createSoloGame(
        kind,
        session,
        aiPlayers,
        turnLengthIndex,
        options,
        gameType,
        galaxySize,
        this.scheduler,
        this::handleTurnTimer);
    session.spectatingGame = null;
  }

  private void sendChatLocked(final BrowserSession session, final String scope, final String message) {
    final String text = message == null ? "" : message.trim();
    if (text.isEmpty()) {
      return;
    }

    final ChatEntry entry = new ChatEntry(scope, session.userId, session.username, text, Instant.now().toEpochMilli(), null);
    if ("room".equalsIgnoreCase(scope) || "game".equalsIgnoreCase(scope)) {
      if (session.room != null) {
        roomMessages(session.room).addLast(entry);
        trim(roomMessages(session.room));
      } else if (session.spectatingGame != null) {
        session.spectatingGame.messages.addLast(entry);
        trim(session.spectatingGame.messages);
      } else if (session.soloGame != null) {
        session.soloGame.messages.addLast(entry);
        trim(session.soloGame.messages);
      } else {
        throw new IllegalStateException("No active room or game chat is available.");
      }
    } else {
      this.lobbyMessages.addLast(entry);
      trim(this.lobbyMessages);
    }
  }

  private void setOrdersLocked(final BrowserSession session, final JsonNode payload) {
    final WebGameSession game = this.requirePlayerGameLocked(session);
    game.setOrders(session, payload.path("buildOrders"), payload.path("moveOrders"), payload.path("projectOrders"));
  }

  private void endTurnLocked(final BrowserSession session) {
    final WebGameSession game = this.requirePlayerGameLocked(session);
    game.endTurn(session);
  }

  private void cancelEndTurnLocked(final BrowserSession session) {
    final WebGameSession game = this.requirePlayerGameLocked(session);
    game.cancelEndTurn(session);
  }

  private void resignLocked(final BrowserSession session) {
    final WebGameSession game = this.requirePlayerGameLocked(session);
    game.handleHumanDeparture(session, true);
  }

  private void rematchLocked(final BrowserSession session) {
    if (session.room != null) {
      final WebRoom room = this.requireOwnedRoomLocked(session);
      if (room.game == null || !room.game.isFinished()) {
        throw new IllegalStateException("The current room game has not finished.");
      }

      final WebGameSession previous = room.game;
      for (final BrowserSession spectator : List.copyOf(previous.spectators)) {
        if (spectator.spectatingGame == previous) {
          spectator.spectatingGame = null;
        }
      }
      previous.spectators.clear();
      this.startRoomGameLocked(session);
      return;
    }

    if (session.soloGame != null) {
      final WebGameSession previous = session.soloGame;
      if (!previous.isFinished()) {
        throw new IllegalStateException("The current game has not finished.");
      }

      previous.shutdown();
      session.soloGame = WebGameSession.createSoloGame(
          previous.kind,
          session,
          previous.aiByPlayer.size(),
          previous.state.turnLengthIndex,
          previous.state.gameOptions,
          previous.state.gameType,
          previous.kind.equals("tutorial") ? GameState.GalaxySize.MEDIUM : previous.state.getGalaxySize(),
          this.scheduler,
          this::handleTurnTimer);
      return;
    }

    throw new IllegalStateException("No finished game is available for rematch.");
  }

  private void requestAllianceLocked(final BrowserSession session, final int targetPlayerIndex) {
    final WebGameSession game = this.requirePlayerGameLocked(session);
    game.requestAlliance(session, targetPlayerIndex);
  }

  private void acceptAllianceLocked(final BrowserSession session, final int targetPlayerIndex) {
    final WebGameSession game = this.requirePlayerGameLocked(session);
    game.acceptAlliance(session, targetPlayerIndex);
  }

  private WebRoom requireRoomLocked(final int roomId) {
    final WebRoom room = this.rooms.get(roomId);
    if (room == null) {
      throw new IllegalStateException("Room not found.");
    }
    return room;
  }

  private WebRoom requireOwnedRoomLocked(final BrowserSession session) {
    final WebRoom room = session.room;
    if (room == null) {
      throw new IllegalStateException("You are not in a room.");
    }
    if (room.owner != session) {
      throw new IllegalStateException("Only the room owner can do that.");
    }
    return room;
  }

  private WebGameSession requirePlayerGameLocked(final BrowserSession session) {
    final WebGameSession game = this.activeGameLocked(session);
    if (game == null || game.playerFor(session) == null) {
      throw new IllegalStateException("No active controllable game is available.");
    }
    return game;
  }

  private @Nullable WebGameSession activeGameLocked(final BrowserSession session) {
    if (session.spectatingGame != null) {
      return session.spectatingGame;
    }
    if (session.soloGame != null) {
      return session.soloGame;
    }
    return session.room == null ? null : session.room.game;
  }

  private void ensureNoActiveSoloGameLocked(final BrowserSession session) {
    if (session.soloGame != null) {
      session.soloGame.shutdown();
      session.soloGame = null;
    }
  }

  private void clearSpectatorGameLocked(final BrowserSession session) {
    if (session.spectatingGame != null) {
      session.spectatingGame.removeSpectator(session);
      session.spectatingGame = null;
    }
  }

  private List<Push> buildPushesLocked() {
    final List<Push> pushes = new ArrayList<>();
    for (final BrowserSession session : this.sessions.values()) {
      if (session.sink != null) {
        pushes.add(new Push(session.sink, this.snapshotForLocked(session, List.of())));
      }
    }
    return pushes;
  }

  private SessionSnapshot snapshotForLocked(final @Nullable BrowserSession session, final List<String> notices) {
    if (session == null) {
      return new SessionSnapshot("auth", null, null, null, notices, this.lobbySnapshotLocked(null), null, null);
    }

    final WebRoom room = session.room;
    final WebGameSession game = this.activeGameLocked(session);
    final String view = game != null ? "game" : room != null ? "room" : "lobby";

    return new SessionSnapshot(
        view,
        new UserSnapshot(session.id, session.username),
        room == null ? null : this.roomSummaryLocked(room, session),
        game == null ? null : game.summaryFor(session),
        notices,
        this.lobbySnapshotLocked(session),
        room == null ? null : this.roomDetailLocked(room),
        game == null ? null : game.detailFor(session));
  }

  private LobbySnapshot lobbySnapshotLocked(final @Nullable BrowserSession viewer) {
    final List<PlayerPresence> players = this.sessions.values().stream()
        .map(session -> new PlayerPresence(
            session.id,
            session.userId,
            session.username,
            session.connected,
            session.room == null ? null : Integer.toString(session.room.id)))
        .toList();

    final List<RoomSummary> roomSummaries = this.rooms.values().stream()
        .map(room -> this.roomSummaryLocked(room, viewer))
        .toList();

    return new LobbySnapshot(players, roomSummaries, this.lobbyMessages.stream().map(ChatEntry::toDto).toList());
  }

  private RoomSummary roomSummaryLocked(final WebRoom room, final @Nullable BrowserSession viewer) {
    final boolean running = room.game != null && !room.game.isFinished();
    final boolean full = room.members.size() >= room.options.maxHumanPlayers;
    final String status = running ? "running" : full ? "full" : "open";
    final boolean member = viewer != null && room.members.contains(viewer);
    final boolean invited = viewer != null && room.invitations.contains(viewer);
    final boolean requested = viewer != null && room.joinRequests.contains(viewer);
    return new RoomSummary(
        Integer.toString(room.id),
        room.owner == null ? "Empty room" : room.owner.username + "'s room",
        room.owner == null ? "Unknown" : room.owner.username,
        room.members.size(),
        room.options.maxHumanPlayers,
        room.options.allowSpectate && room.game != null,
        room.options.accessMode == AccessMode.OPEN,
        status,
        member,
        invited,
        requested);
  }

  private RoomDetail roomDetailLocked(final WebRoom room) {
    return new RoomDetail(
        Integer.toString(room.id),
        room.owner == null ? null : room.owner.id,
        room.owner == null ? "Unknown" : room.owner.username,
        room.members.stream().map(this::roomMember).toList(),
        room.invitations.stream().map(this::roomMember).toList(),
        room.joinRequests.stream().map(this::roomMember).toList(),
        new RoomOptionsSnapshot(
            room.options.maxHumanPlayers,
            room.options.aiPlayers,
            room.options.turnLengthIndex,
            room.options.gameType.name(),
            room.options.galaxySize.name(),
            room.options.classicRuleset,
            room.options.allowSpectate,
            room.options.accessMode.name()),
        room.game != null,
        room.options.allowSpectate,
        roomMessages(room).stream().map(ChatEntry::toDto).toList());
  }

  private Deque<ChatEntry> roomMessages(final WebRoom room) {
    return room.game != null ? room.game.messages : room.messages;
  }

  private RoomMember roomMember(final BrowserSession session) {
    return new RoomMember(session.id, session.userId, session.username, session.connected);
  }

  private Optional<BrowserSession> findSessionByUserIdLocked(final long userId) {
    return this.sessions.values().stream().filter(session -> session.userId == userId).findFirst();
  }

  private String normalizeDisplayName(final @Nullable String requestedDisplayName) {
    final String trimmed = requestedDisplayName == null ? "" : requestedDisplayName.trim();
    final StringBuilder builder = new StringBuilder(12);
    for (int i = 0; i < trimmed.length() && builder.length() < 12; ++i) {
      final char c = trimmed.charAt(i);
      if (Character.isLetterOrDigit(c) || c == ' ' || c == '-' || c == '_') {
        builder.append(c);
      }
    }
    final String normalized = builder.toString().trim();
    return normalized.isEmpty() ? "Commander" : normalized;
  }

  private String allocateDisplayName(final String baseDisplayName) {
    final Set<String> existing = this.sessions.values().stream()
        .map(session -> session.username.toLowerCase(Locale.ROOT))
        .collect(LinkedHashSet::new, Set::add, Set::addAll);

    if (!existing.contains(baseDisplayName.toLowerCase(Locale.ROOT))) {
      return baseDisplayName;
    }

    for (int i = 2; i < 100; ++i) {
      final String candidate = truncate(baseDisplayName, 10) + " " + i;
      if (!existing.contains(candidate.toLowerCase(Locale.ROOT))) {
        return candidate;
      }
    }

    return truncate(baseDisplayName, 7) + "-" + UUID.randomUUID().toString().substring(0, 4);
  }

  private static String truncate(final String value, final int maxLength) {
    return value.length() <= maxLength ? value : value.substring(0, maxLength);
  }

  private static void trim(final Deque<ChatEntry> entries) {
    while (entries.size() > MAX_CHAT_MESSAGES) {
      entries.removeFirst();
    }
  }

  private static int clamp(final int value, final int min, final int max) {
    return Math.max(min, Math.min(max, value));
  }

  private static GameState.GameType parseGameType(final String value, final GameState.GameType fallback) {
    try {
      return GameState.GameType.valueOf(value.toUpperCase(Locale.ROOT));
    } catch (final IllegalArgumentException e) {
      return fallback;
    }
  }

  private static GameState.GalaxySize parseGalaxySize(final String value, final GameState.GalaxySize fallback) {
    try {
      return GameState.GalaxySize.valueOf(value.toUpperCase(Locale.ROOT));
    } catch (final IllegalArgumentException e) {
      return fallback;
    }
  }

  private static AccessMode parseAccessMode(final String value, final AccessMode fallback) {
    try {
      return AccessMode.valueOf(value.toUpperCase(Locale.ROOT));
    } catch (final IllegalArgumentException e) {
      return fallback;
    }
  }

  private void handleTurnTimer(final WebGameSession game) {
    final List<Push> pushes;
    synchronized (this) {
      if (game.isShutdown()) {
        return;
      }
      game.forceAdvanceTurn();
      pushes = this.buildPushesLocked();
    }
    pushes.forEach(push -> push.sink.send(push.snapshot));
  }

  public interface Sink {
    void send(SessionSnapshot snapshot);
  }

  public record Push(Sink sink, SessionSnapshot snapshot) {}

  public record SessionSnapshot(
      String view,
      UserSnapshot user,
      RoomSummary room,
      GameSummary game,
      List<String> notices,
      LobbySnapshot lobby,
      RoomDetail roomDetail,
      GameDetail gameDetail) {}

  public record UserSnapshot(String id, String displayName) {}
  public record LobbySnapshot(List<PlayerPresence> players, List<RoomSummary> rooms, List<ChatMessage> messages) {}
  public record PlayerPresence(String id, long userId, String displayName, boolean connected, String roomId) {}
  public record RoomSummary(
      String id,
      String title,
      String ownerName,
      int playerCount,
      int maxPlayers,
      boolean canSpectate,
      boolean isPublic,
      String status,
      boolean member,
      boolean invited,
      boolean requested) {}
  public record RoomDetail(
      String id,
      String ownerSessionId,
      String ownerName,
      List<RoomMember> members,
      List<RoomMember> invitations,
      List<RoomMember> joinRequests,
      RoomOptionsSnapshot options,
      boolean started,
      boolean canSpectate,
      List<ChatMessage> messages) {}
  public record RoomMember(String id, long userId, String displayName, boolean connected) {}
  public record RoomOptionsSnapshot(
      int maxHumanPlayers,
      int aiPlayers,
      int turnLengthIndex,
      String gameType,
      String galaxySize,
      boolean classicRuleset,
      boolean allowSpectate,
      String accessMode) {}
  public record GameSummary(String id, int turn, String phase, String playerName, String boardLabel, int waitingOn) {}
  public record GameDetail(
      String id,
      String kind,
      boolean spectator,
      Integer localPlayerIndex,
      boolean endedTurn,
      int turnNumber,
      String turnName,
      int turnTicksLeft,
      int turnDurationTicks,
      boolean ended,
      Integer winnerIndex,
      int waitingOn,
      String gameType,
      String galaxySize,
      boolean classicRuleset,
      List<GamePlayer> players,
      List<SystemSnapshot> systems,
      List<TannhauserSnapshot> tannhauserLinks,
      List<ForceSnapshot> forces,
      OrdersSnapshot pendingOrders,
      List<ChatMessage> messages,
      List<String> eventLog,
      List<ResolvedEventSnapshot> resolvedEvents,
      VictorySnapshot victory) {}
  public record ResolvedEventSnapshot(
      String kind,
      Integer playerIndex,
      Integer sourceIndex,
      Integer targetIndex,
      Integer systemIndex,
      int quantity,
      String projectType,
      Integer ownerAtCombatStart,
      List<CombatantSnapshot> combatants,
      Integer victorIndex,
      int fleetsAtEnd,
      int kills,
      int garrisonAtCollapse,
      int minimumGarrisonAtCollapse) {}
  public record CombatantSnapshot(
      Integer playerIndex,
      Integer sourceIndex,
      int fleetsAtStart,
      int fleetsDestroyed,
      int fleetsRetreated) {}
  public record GamePlayer(
      int index,
      String name,
      int color,
      int accentColor,
      boolean defeated,
      boolean resigned,
      int[] researchPoints,
      boolean[] allies,
      int incomingPactOffersBitmap,
      int outgoingPactOffersBitmap,
      String[] stats) {}
  public record SystemSnapshot(
      int index,
      String name,
      int x,
      int y,
      int ownerIndex,
      int garrison,
      int minimumGarrison,
      boolean hasDefensiveNet,
      int[] resources,
      int[] neighbors,
      int score,
      int type) {}
  public record TannhauserSnapshot(int fromIndex, int toIndex, int turnsLeft) {}
  public record ForceSnapshot(
      String id,
      int playerIndex,
      boolean unified,
      int capitalIndex,
      List<Integer> systems,
      int fleetProduction,
      int fleetsAvailableToBuild,
      int[] surplusResources,
      int[] surplusResourceRanks) {}
  public record OrdersSnapshot(List<BuildOrderSnapshot> buildOrders, List<MoveOrderSnapshot> moveOrders, List<ProjectOrderSnapshot> projectOrders) {}
  public record BuildOrderSnapshot(int systemIndex, int quantity) {}
  public record MoveOrderSnapshot(int sourceIndex, int targetIndex, int quantity) {}
  public record ProjectOrderSnapshot(String type, Integer sourceIndex, Integer targetIndex) {}
  public record VictorySnapshot(List<Integer> leaders, List<Integer> victors) {}
  public record ChatMessage(String scope, long senderId, String senderName, String message, long timestamp) {}

  private static final class BrowserSession {
    private final String id;
    private final long userId;
    private final String username;
    private boolean connected;
    private Sink sink;
    private WebRoom room;
    private WebGameSession soloGame;
    private WebGameSession spectatingGame;

    private BrowserSession(final String id, final long userId, final String username) {
      this.id = id;
      this.userId = userId;
      this.username = username;
      this.connected = false;
    }
  }

  private static final class WebRoom {
    private final int id;
    private BrowserSession owner;
    private final List<BrowserSession> members = new ArrayList<>();
    private final Set<BrowserSession> invitations = new LinkedHashSet<>();
    private final Set<BrowserSession> joinRequests = new LinkedHashSet<>();
    private final Deque<ChatEntry> messages = new ArrayDeque<>();
    private final RoomOptions options = new RoomOptions();
    private WebGameSession game;
    private long startedAt;
    private long finalElapsedTimeMillis = -1L;

    private WebRoom(final int id, final BrowserSession owner) {
      this.id = id;
      this.owner = owner;
    }
  }

  private enum AccessMode {
    INVITE_ONLY,
    OPEN
  }

  private static final class RoomOptions {
    private int maxHumanPlayers = 4;
    private int aiPlayers = 0;
    private int turnLengthIndex = 0;
    private GameState.GameType gameType = GameState.GameType.CONQUEST;
    private GameState.GalaxySize galaxySize = GameState.GalaxySize.MEDIUM;
    private boolean classicRuleset = true;
    private boolean allowSpectate = true;
    private AccessMode accessMode = AccessMode.INVITE_ONLY;
  }

  private static final class ChatEntry {
    private final String scope;
    private final long senderId;
    private final String senderName;
    private final String message;
    private final long timestamp;
    private final Integer recipientPlayerIndex;

    private ChatEntry(final String scope,
                      final long senderId,
                      final String senderName,
                      final String message,
                      final long timestamp,
                      final Integer recipientPlayerIndex) {
      this.scope = scope;
      this.senderId = senderId;
      this.senderName = senderName;
      this.message = message;
      this.timestamp = timestamp;
      this.recipientPlayerIndex = recipientPlayerIndex;
    }

    private ChatMessage toDto() {
      return new ChatMessage(this.scope, this.senderId, this.senderName, this.message, this.timestamp);
    }
  }

  private static final class WebPlayerTurnState {
    private final BrowserSession session;
    private final Player player;
    private final List<ProjectOrder> projectOrders = new ArrayList<>();
    private final List<BuildFleetsOrder> buildOrders = new ArrayList<>();
    private final List<MoveFleetsOrder> moveOrders = new ArrayList<>();
    private boolean endedTurn;

    private WebPlayerTurnState(final BrowserSession session, final Player player) {
      this.session = session;
      this.player = player;
    }

    private void replaceOrders(final GameState state,
                               final List<ProjectOrder> projects,
                               final List<BuildFleetsOrder> builds,
                               final List<MoveFleetsOrder> moves) {
      this.projectOrders.clear();
      this.projectOrders.addAll(projects);
      this.buildOrders.clear();
      this.buildOrders.addAll(builds);
      this.moveOrders.clear();
      this.moveOrders.addAll(moves);
      state.validateOrders(this.player, this.projectOrders, this.buildOrders, this.moveOrders);
      this.endedTurn = false;
    }

    private void resetForTurnStart() {
      this.projectOrders.clear();
      this.buildOrders.clear();
      this.moveOrders.clear();
      this.endedTurn = false;
    }

    private void submit(final GameState state) {
      state.validateOrders(this.player, this.projectOrders, this.buildOrders, this.moveOrders);
      state.addOrders(this.projectOrders, this.buildOrders, this.moveOrders);
    }
  }

  private static final class WebGameSession extends GameSession {
    private final String id = UUID.randomUUID().toString();
    private final String kind;
    private final @Nullable WebRoom room;
    private final GameState state;
    private final ScheduledExecutorService scheduler;
    private final Consumer<WebGameSession> turnTimerCallback;
    private final Map<BrowserSession, WebPlayerTurnState> humanPlayers = new LinkedHashMap<>();
    private final Map<Player, AI> aiByPlayer = new LinkedHashMap<>();
    private final Set<BrowserSession> spectators = new LinkedHashSet<>();
    private final Deque<ChatEntry> messages = new ArrayDeque<>();
    private final List<String> eventLog = new ArrayList<>();
    private final List<ResolvedEventSnapshot> resolvedEvents = new ArrayList<>();
    private ScheduledFuture<?> endTurnFuture;
    private long turnEndTimestamp;
    private int playersLeftBitmap;
    private int alliancesBitmapAtTurnStart;
    private int turnSeed = -1;
    private boolean shutdown;

    private WebGameSession(final String kind,
                           final @Nullable WebRoom room,
                           final GameState state,
                           final ScheduledExecutorService scheduler,
                           final Consumer<WebGameSession> turnTimerCallback) {
      this.kind = kind;
      this.room = room;
      this.state = state;
      this.scheduler = scheduler;
      this.turnTimerCallback = turnTimerCallback;
    }

    private static WebGameSession createRoomGame(final WebRoom room,
                                                 final int aiPlayers,
                                                 final ScheduledExecutorService scheduler,
                                                 final Consumer<WebGameSession> turnTimerCallback) {
      final String[] playerNames = new String[room.members.size() + aiPlayers];
      for (int i = 0; i < room.members.size(); ++i) {
        playerNames[i] = room.members.get(i).username;
      }
      System.arraycopy(StringConstants.EMPIRE_NAMES, room.members.size(), playerNames, room.members.size(), aiPlayers);

      final GameOptions options = room.options.classicRuleset ? GameOptions.CLASSIC_GAME_OPTIONS : GameOptions.STREAMLINED_GAME_OPTIONS;
      final GameState state = GameState.generate(
          room.options.turnLengthIndex,
          playerNames,
          options,
          room.options.gameType,
          room.options.galaxySize);
      final WebGameSession game = new WebGameSession("multiplayer", room, state, scheduler, turnTimerCallback);
      game.initializeHumans(room.members);
      game.initializeAis(room.members.size());
      game.start();
      return game;
    }

    private static WebGameSession createSoloGame(final String kind,
                                                 final BrowserSession owner,
                                                 final int aiPlayers,
                                                 final int turnLengthIndex,
                                                 final GameOptions options,
                                                 final GameState.GameType requestedGameType,
                                                 final GameState.GalaxySize galaxySize,
                                                 final ScheduledExecutorService scheduler,
                                                 final Consumer<WebGameSession> turnTimerCallback) {
      final String[] playerNames = new String[1 + aiPlayers];
      playerNames[0] = owner.username;
      System.arraycopy(StringConstants.EMPIRE_NAMES, 0, playerNames, 1, aiPlayers);

      final GameState state;
      if ("tutorial".equals(kind)) {
        state = new GameState(turnLengthIndex, options, GameState.GameType.TUTORIAL, playerNames);
        state.map = new TutorialMapGenerator().generate();
        state.map.assignPlayerHomeworlds(state.players, options);
        state.recalculateFleetProduction();
        state.recalculatePlayerFleetProduction();
      } else {
        state = GameState.generate(turnLengthIndex, playerNames, options, requestedGameType, galaxySize);
      }

      final WebGameSession game = new WebGameSession(kind, null, state, scheduler, turnTimerCallback);
      game.initializeHumans(List.of(owner));
      game.initializeAis(1);
      game.start();
      return game;
    }

    private void initializeHumans(final List<BrowserSession> humans) {
      for (int i = 0; i < humans.size(); ++i) {
        final Player player = this.state.players[i];
        player.name = humans.get(i).username;
        player.stats = new PlayerStats(20);
        this.humanPlayers.put(humans.get(i), new WebPlayerTurnState(humans.get(i), player));
      }
      for (int i = humans.size(); i < this.state.players.length; ++i) {
        this.state.players[i].stats = new PlayerStats(20);
      }
    }

    private void initializeAis(final int firstAiIndex) {
      for (int i = firstAiIndex; i < this.state.players.length; ++i) {
        final TaskAI ai = new TaskAI(this.state.players[i], this.state, this);
        ai.initialize(true);
        this.aiByPlayer.put(this.state.players[i], ai);
      }
    }

    private void start() {
      this.state.recalculatePlayerFleetProduction();
      for (final Player player : this.state.players) {
        if (player.contiguousForces.isEmpty()) {
          this.state.markPlayerDefeated(player.index);
        }
      }
      this.processTurnStart();
      this.scheduleTurnEnd();
    }

    @Override
    protected @NotNull Optional<AI> getAI(final @NotNull Player player) {
      return Optional.ofNullable(this.aiByPlayer.get(player));
    }

    @Override
    public void showAIChatMessage(final @NotNull Player sender,
                                  final @NotNull Player recipient,
                                  final int which,
                                  final int systemIndex) {
      final String[] templates = StringConstants.AI_CHAT[Math.max(0, Math.min(which, StringConstants.AI_CHAT.length - 1))];
      final String template = templates.length == 0 ? "AI message" : templates[0];
      final String systemName = systemIndex >= 0 && systemIndex < this.state.map.systems.length
          ? this.state.map.systems[systemIndex].name
          : "";
      final String message = template
          .replace("<%me>", sender.name)
          .replace("<%you>", recipient.name)
          .replace("<%largestplayer>", this.largestPlayerName())
          .replace("<%system>", systemName);
      this.messages.addLast(new ChatEntry("game", -1L, sender.name, message, Instant.now().toEpochMilli(), recipient.index));
      trim(this.messages);
    }

    private String largestPlayerName() {
      return Arrays.stream(this.state.players)
          .filter(player -> !this.state.isPlayerDefeated(player.index))
          .max((a, b) -> Integer.compare(this.state.playerFleetProduction[a.index], this.state.playerFleetProduction[b.index]))
          .map(player -> player.name)
          .orElse(this.state.players[0].name);
    }

    private void addSpectator(final BrowserSession session) {
      this.spectators.add(session);
    }

    private void removeSpectator(final BrowserSession session) {
      this.spectators.remove(session);
    }

    private @Nullable Player playerFor(final BrowserSession session) {
      final WebPlayerTurnState playerState = this.humanPlayers.get(session);
      return playerState == null ? null : playerState.player;
    }

    private boolean isFinished() {
      return this.state.hasEnded;
    }

    private boolean isShutdown() {
      return this.shutdown;
    }

    private void shutdown() {
      if (this.endTurnFuture != null) {
        this.endTurnFuture.cancel(false);
        this.endTurnFuture = null;
      }
      this.shutdown = true;
    }

    private void setOrders(final BrowserSession session,
                           final JsonNode buildOrdersNode,
                           final JsonNode moveOrdersNode,
                           final JsonNode projectOrdersNode) {
      final WebPlayerTurnState playerState = Objects.requireNonNull(this.humanPlayers.get(session), "player state");
      final List<ProjectOrder> projects = new ArrayList<>();
      final List<BuildFleetsOrder> builds = new ArrayList<>();
      final List<MoveFleetsOrder> moves = new ArrayList<>();

      if (buildOrdersNode.isArray()) {
        buildOrdersNode.forEach(node -> {
          final StarSystem system = this.system(node.path("systemIndex").asInt(-1));
          if (system != null) {
            builds.add(new BuildFleetsOrder(system, Math.max(0, node.path("quantity").asInt(0))));
          }
        });
      }

      if (moveOrdersNode.isArray()) {
        moveOrdersNode.forEach(node -> {
          final StarSystem source = this.system(node.path("sourceIndex").asInt(-1));
          final StarSystem target = this.system(node.path("targetIndex").asInt(-1));
          if (source != null && target != null) {
            moves.add(new MoveFleetsOrder(playerState.player, source, target, Math.max(0, node.path("quantity").asInt(0))));
          }
        });
      }

      if (projectOrdersNode.isArray()) {
        projectOrdersNode.forEach(node -> {
          final String type = node.path("type").asText("").toUpperCase(Locale.ROOT);
          final StarSystem target = this.system(node.path("targetIndex").asInt(-1));
          switch (type) {
            case "METAL" -> {
              if (target != null) {
                projects.add(new ProjectOrder(GameState.ResourceType.METAL, playerState.player, target));
              }
            }
            case "BIOMASS" -> {
              if (target != null) {
                projects.add(new ProjectOrder(GameState.ResourceType.BIOMASS, playerState.player, target));
              }
            }
            case "ENERGY" -> {
              if (target != null) {
                projects.add(new ProjectOrder(GameState.ResourceType.ENERGY, playerState.player, target));
              }
            }
            case "EXOTICS" -> {
              final StarSystem source = this.system(node.path("sourceIndex").asInt(-1));
              if (source != null && target != null) {
                projects.add(new ProjectOrder(playerState.player, source, target));
              }
            }
          }
        });
      }

      playerState.replaceOrders(this.state, projects, builds, moves);
    }

    private void endTurn(final BrowserSession session) {
      final WebPlayerTurnState playerState = Objects.requireNonNull(this.humanPlayers.get(session), "player state");
      if (!this.state.isPlayerDefeated(playerState.player.index)) {
        playerState.endedTurn = true;
      }
      if (this.haveAllPlayersEndedTurn()) {
        this.forceAdvanceTurn();
      }
    }

    private void cancelEndTurn(final BrowserSession session) {
      final WebPlayerTurnState playerState = Objects.requireNonNull(this.humanPlayers.get(session), "player state");
      playerState.endedTurn = false;
    }

    private void requestAlliance(final BrowserSession session, final int targetPlayerIndex) {
      final Player offerer = Objects.requireNonNull(this.playerFor(session), "player");
      if (targetPlayerIndex < 0 || targetPlayerIndex >= this.state.playerCount || targetPlayerIndex == offerer.index) {
        return;
      }
      final Player offeree = this.state.players[targetPlayerIndex];
      if (offerer.hasPactOfferFrom(offeree)) {
        Player.establishPact(offerer, offeree);
        this.handlePactAccepted(offerer, offeree);
      } else if (!offeree.hasPactOfferFrom(offerer)) {
        Player.offerPact(offerer, offeree);
        this.handlePactOffered(offerer, offeree);
      }
    }

    private void acceptAlliance(final BrowserSession session, final int targetPlayerIndex) {
      this.requestAlliance(session, targetPlayerIndex);
    }

    private void handlePactOffered(final Player offerer, final Player offeree) {
      this.getAI(offeree).ifPresent(ai -> ai.handlePactOffer(offerer));
    }

    private void handleHumanDeparture(final BrowserSession session, final boolean resign) {
      final WebPlayerTurnState playerState = this.humanPlayers.remove(session);
      if (playerState == null) {
        return;
      }
      this.playersLeftBitmap |= 1 << playerState.player.index;
      if (resign && !this.state.hasEnded && !this.state.isPlayerDefeated(playerState.player.index)) {
        this.state.receiveResignation(playerState.player.index);
        this.state.checkVictory();
      }
      if (this.haveAllPlayersEndedTurn()) {
        this.forceAdvanceTurn();
      }
    }

    private void processTurnStart() {
      this.humanPlayers.values().forEach(WebPlayerTurnState::resetForTurnStart);
      if (this.state.hasEnded) {
        if (this.room != null) {
          this.room.finalElapsedTimeMillis = Math.max(0L, Instant.now().toEpochMilli() - this.room.startedAt);
        }
        this.shutdown();
      } else {
        this.aiByPlayer.values().forEach(AI::makeDesiredPactOffers);
      }
    }

    private void scheduleTurnEnd() {
      if (this.shutdown || this.state.hasEnded) {
        return;
      }
      if (this.endTurnFuture != null) {
        this.endTurnFuture.cancel(false);
      }
      this.turnEndTimestamp = Instant.now().toEpochMilli() + this.state.getTurnDurationMillis();
      final long delay = this.areAllHumanPlayersDefeated() ? 5000L : this.state.getTurnDurationMillis();
      this.endTurnFuture = this.scheduler.schedule(() -> this.turnTimerCallback.accept(this), delay, TimeUnit.MILLISECONDS);
    }

    private void forceAdvanceTurn() {
      if (this.shutdown || this.state.hasEnded) {
        return;
      }
      this.alliancesBitmapAtTurnStart = this.state.getAlliancesBitmap();
      this.state.resetTurnState();
      this.humanPlayers.values().forEach(playerState -> playerState.submit(this.state));

      for (final StarSystem system : this.state.map.systems) {
        system.remainingGarrison = system.garrison;
      }
      this.aiByPlayer.values().forEach(AI::planTurnOrders);

      this.turnSeed = (int) System.nanoTime();
      this.state.recalculateFleetsRemaining();
      final TurnEventLog turnEventLog = new TurnEventLog();
      this.state.simulateTurn(turnEventLog, this.turnSeed);
      this.state.generateNewTurnName();
      this.state.recalculatePlayerFleetProduction();
      this.eventLog.clear();
      turnEventLog.events.forEach(event -> this.eventLog.add(event.getClass().getSimpleName()));
      this.rebuildResolvedEvents(turnEventLog);
      this.processTurnStart();
      this.scheduleTurnEnd();
    }

    private boolean haveAllPlayersEndedTurn() {
      return this.humanPlayers.values().stream()
          .allMatch(playerState -> playerState.endedTurn || this.state.isPlayerDefeated(playerState.player.index));
    }

    private boolean areAllHumanPlayersDefeated() {
      return this.humanPlayers.values().stream()
          .allMatch(playerState -> this.state.isPlayerDefeated(playerState.player.index));
    }

    private int waitingOnCount() {
      return (int) this.humanPlayers.values().stream()
          .filter(playerState -> !this.state.isPlayerDefeated(playerState.player.index))
          .filter(playerState -> !playerState.endedTurn)
          .count();
    }

    private int turnTicksLeft() {
      return Math.max(0, (int) ((this.turnEndTimestamp - Instant.now().toEpochMilli()) / GameState.MILLIS_PER_TICK));
    }

    private GameSummary summaryFor(final BrowserSession viewer) {
      final Player localPlayer = this.playerFor(viewer);
      final String playerName = localPlayer == null ? "Spectating" : localPlayer.name;
      return new GameSummary(
          this.id,
          this.state.turnNumber,
          this.state.hasEnded ? "Finished" : "Orders",
          playerName,
          this.kind.equals("tutorial") ? "Tutorial board" : this.state.gameType.name().replace('_', ' '),
          this.waitingOnCount());
    }

    private GameDetail detailFor(final BrowserSession viewer) {
      final Player localPlayer = this.playerFor(viewer);
      final Integer localPlayerIndex = localPlayer == null ? null : localPlayer.index;
      final List<GamePlayer> players = Arrays.stream(this.state.players)
          .map(player -> new GamePlayer(
              player.index,
              player.name,
              player.color1,
              player.color2,
              this.state.isPlayerDefeated(player.index),
              this.state.didPlayerResign(player.index),
              Arrays.copyOf(player.researchPoints, player.researchPoints.length),
              Arrays.copyOf(player.allies, player.allies.length),
              player.incomingPactOffersBitmap,
              player.outgoingPactOffersBitmap,
              player.stats == null ? new String[16] : player.stats.a061()))
          .toList();

      final List<SystemSnapshot> systems = Arrays.stream(this.state.map.systems)
          .map(system -> new SystemSnapshot(
              system.index,
              system.name,
              system.posnX,
              system.posnY,
              system.owner == null ? -1 : system.owner.index,
              system.garrison,
              system.minimumGarrison,
              system.hasDefensiveNet,
              Arrays.copyOf(system.resources, system.resources.length),
              Arrays.stream(system.neighbors).mapToInt(neighbor -> neighbor.index).toArray(),
              system.score,
              system.type))
          .toList();

      final List<TannhauserSnapshot> links = this.state.tannhauserLinks.stream()
          .map(link -> new TannhauserSnapshot(link.system1.index, link.system2.index, link.turnsLeft))
          .toList();

      final List<ForceSnapshot> forces = new ArrayList<>();
      for (final Player player : this.state.players) {
        if (this.state.gameOptions.unifiedTerritories) {
          if (player.combinedForce != null && !player.combinedForce.isEmpty()) {
            forces.add(forceSnapshot("combined-" + player.index, player.combinedForce, true));
          }
        } else {
          for (int i = 0; i < player.contiguousForces.size(); ++i) {
            forces.add(forceSnapshot("force-" + player.index + "-" + i, player.contiguousForces.get(i), false));
          }
        }
      }

      final WebPlayerTurnState pending = localPlayer == null ? null : this.humanPlayers.get(viewer);
      final OrdersSnapshot pendingOrders = pending == null
          ? new OrdersSnapshot(List.of(), List.of(), List.of())
          : new OrdersSnapshot(
              pending.buildOrders.stream().map(order -> new BuildOrderSnapshot(order.system.index, order.quantity)).toList(),
              pending.moveOrders.stream().map(order -> new MoveOrderSnapshot(order.source.index, order.target.index, order.quantity)).toList(),
              pending.projectOrders.stream().map(order -> new ProjectOrderSnapshot(
                  resourceTypeName(order.type),
                  order.source == null ? null : order.source.index,
                  order.target == null ? null : order.target.index)).toList());

      final Integer recipientPlayerIndex = localPlayerIndex;
      final List<ChatMessage> visibleMessages = this.messages.stream()
          .filter(message -> message.recipientPlayerIndex == null || Objects.equals(message.recipientPlayerIndex, recipientPlayerIndex))
          .map(ChatEntry::toDto)
          .toList();

      return new GameDetail(
          this.id,
          this.kind,
          localPlayer == null,
          localPlayerIndex,
          pending != null && pending.endedTurn,
          this.state.turnNumber,
          this.state.turnName(),
          this.turnTicksLeft(),
          this.state.getTurnDurationTicks(),
          this.state.hasEnded,
          this.state.winnerIndex >= 0 ? this.state.winnerIndex : null,
          this.waitingOnCount(),
          this.state.gameType.name(),
          this.kind.equals("tutorial") ? "TUTORIAL" : this.state.getGalaxySize().name(),
          this.state.gameOptions == GameOptions.CLASSIC_GAME_OPTIONS,
          players,
          systems,
          links,
          forces,
          pendingOrders,
          visibleMessages,
          List.copyOf(this.eventLog),
          List.copyOf(this.resolvedEvents),
          new VictorySnapshot(
              Arrays.stream(this.state.victoryChecker.currentObjectiveLeaders())
                  .filter(Objects::nonNull)
                  .map(player -> player.index)
                  .toList(),
              this.state.victoryChecker.getVictors() == null ? List.of()
                  : Arrays.stream(this.state.victoryChecker.getVictors()).filter(Objects::nonNull).map(player -> player.index).toList()));
    }

    private static ForceSnapshot forceSnapshot(final String id, final Force force, final boolean unified) {
      return new ForceSnapshot(
          id,
          force.player.index,
          unified,
          force.getCapital() == null ? -1 : force.getCapital().index,
          force.stream().map(system -> system.index).toList(),
          force.fleetProduction,
          force.fleetsAvailableToBuild,
          force.surplusResources == null ? new int[4] : Arrays.copyOf(force.surplusResources, force.surplusResources.length),
          force.surplusResourceRanks == null ? new int[4] : Arrays.copyOf(force.surplusResourceRanks, force.surplusResourceRanks.length));
    }

    private void rebuildResolvedEvents(final TurnEventLog turnEventLog) {
      this.resolvedEvents.clear();

      for (final TurnEventLog.Event event : turnEventLog.events) {
        if (event instanceof final MoveFleetsOrder moveOrder) {
          this.resolvedEvents.add(new ResolvedEventSnapshot(
              "MOVE",
              playerIndex(moveOrder.player),
              moveOrder.source.index,
              moveOrder.target.index,
              moveOrder.target.index,
              moveOrder.quantity,
              null,
              null,
              List.of(),
              null,
              0,
              0,
              0,
              0));
        } else if (event instanceof final CombatEngagementLog combatLog) {
          final List<CombatantSnapshot> combatants = combatantSnapshots(combatLog);
          this.resolvedEvents.add(new ResolvedEventSnapshot(
              "COMBAT",
              null,
              null,
              null,
              combatLog.system.index,
              combatants.stream().mapToInt(CombatantSnapshot::fleetsAtStart).sum(),
              null,
              playerIndex(combatLog.ownerAtCombatStart),
              combatants,
              playerIndex(combatLog.victor),
              combatLog.fleetsAtCombatEnd,
              combatLog.totalKills,
              0,
              0));
        } else if (event instanceof final ProjectOrder projectOrder) {
          this.resolvedEvents.add(new ResolvedEventSnapshot(
              "PROJECT",
              playerIndex(projectOrder.player),
              systemIndex(projectOrder.source),
              systemIndex(projectOrder.target),
              systemIndex(projectOrder.target != null ? projectOrder.target : projectOrder.source),
              0,
              resourceTypeName(projectOrder.type),
              null,
              List.of(),
              null,
              0,
              0,
              0,
              0));
        } else if (event instanceof final StellarBombEvent bombEvent) {
          this.resolvedEvents.add(new ResolvedEventSnapshot(
              "PROJECT",
              playerIndex(bombEvent.player),
              null,
              bombEvent.target.index,
              bombEvent.target.index,
              bombEvent.kill,
              resourceTypeName(GameState.ResourceType.ENERGY),
              null,
              List.of(),
              null,
              0,
              bombEvent.kill,
              0,
              0));
        } else if (event instanceof final FleetRetreatEvent retreatEvent) {
          final int retreatQuantity = retreatEvent.quantities == null
              ? 0
              : Arrays.stream(retreatEvent.quantities).sum();

          this.resolvedEvents.add(new ResolvedEventSnapshot(
              "COLLAPSE",
              playerIndex(retreatEvent.source.lastOwner),
              retreatEvent.source.index,
              null,
              retreatEvent.source.index,
              retreatQuantity,
              null,
              null,
              List.of(),
              null,
              0,
              0,
              retreatEvent.garrisonAtCollapse,
              retreatEvent.minimumGarrisonAtCollapse));

          if (retreatEvent.targets != null && retreatEvent.quantities != null) {
            for (int i = 0; i < retreatEvent.targets.length; ++i) {
              if (retreatEvent.quantities[i] <= 0) {
                continue;
              }
              this.resolvedEvents.add(new ResolvedEventSnapshot(
                  "RETREAT",
                  playerIndex(retreatEvent.source.lastOwner),
                  retreatEvent.source.index,
                  retreatEvent.targets[i].index,
                  retreatEvent.source.index,
                  retreatEvent.quantities[i],
                  null,
                  null,
                  List.of(),
                  null,
                  0,
                  0,
                  0,
                  0));
            }
          }
        } else if (event instanceof final BuildFleetsEvent buildEvent) {
          this.resolvedEvents.add(new ResolvedEventSnapshot(
              "BUILD",
              playerIndex(buildEvent.player),
              null,
              buildEvent.system.index,
              buildEvent.system.index,
              buildEvent.quantity,
              null,
              null,
              List.of(),
              null,
              0,
              0,
              0,
              0));
        }
      }
    }

    private @Nullable StarSystem system(final int index) {
      return index >= 0 && index < this.state.map.systems.length ? this.state.map.systems[index] : null;
    }

    private static CombatantSnapshot combatantSnapshot(final CombatLogEvent combatEvent) {
      return new CombatantSnapshot(
          playerIndex(combatEvent.player),
          systemIndex(combatEvent.source),
          combatEvent.fleetsAtStart,
          combatEvent.fleetsDestroyed,
          combatEvent.fleetsRetreated);
    }

    private static List<CombatantSnapshot> combatantSnapshots(final CombatEngagementLog combatLog) {
      final List<CombatantSnapshot> snapshots = new ArrayList<>(combatLog.events.stream()
          .map(WebGameSession::combatantSnapshot)
          .toList());

      if (combatLog.ownerAtCombatStart == null && combatLog.fleetsAtCombatStart.length > 0) {
        final int neutralStart = combatLog.fleetsAtCombatStart[combatLog.fleetsAtCombatStart.length - 1];
        final boolean neutralAlreadyPresent = snapshots.stream()
            .anyMatch(snapshot -> snapshot.playerIndex() == null && snapshot.sourceIndex() == null);

        if (neutralStart > 0 && !neutralAlreadyPresent) {
          final int neutralEnd = combatLog.victor == null ? combatLog.fleetsAtCombatEnd : 0;
          snapshots.add(new CombatantSnapshot(
              null,
              null,
              neutralStart,
              Math.max(0, neutralStart - neutralEnd),
              0));
        }
      }

      return List.copyOf(snapshots);
    }

    private static @Nullable Integer playerIndex(final @Nullable Player player) {
      return player == null ? null : player.index;
    }

    private static @Nullable Integer systemIndex(final @Nullable StarSystem system) {
      return system == null ? null : system.index;
    }

    private static String resourceTypeName(final int type) {
      return switch (type) {
        case GameState.ResourceType.METAL -> "METAL";
        case GameState.ResourceType.BIOMASS -> "BIOMASS";
        case GameState.ResourceType.ENERGY -> "ENERGY";
        case GameState.ResourceType.EXOTICS -> "EXOTICS";
        default -> "UNKNOWN";
      };
    }
  }
}
