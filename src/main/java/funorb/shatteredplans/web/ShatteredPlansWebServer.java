package funorb.shatteredplans.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;

import java.util.List;
import java.util.Map;

public final class ShatteredPlansWebServer {
  private static final String SESSION_COOKIE = "sp_session";
  private static final int COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

  private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
  private final WebState state = new WebState();
  private final Javalin app;
  private final int port;

  public ShatteredPlansWebServer(final int port) {
    this.port = port;
    this.app = Javalin.create(config -> config.showJavalinBanner = false);
    this.registerRoutes();
  }

  private void registerRoutes() {
    this.app.exception(IllegalStateException.class, (error, ctx) ->
        ctx.status(400).json(Map.of("error", error.getMessage())));

    this.app.get("/api/health", ctx -> ctx.json(Map.of("ok", true)));

    this.app.get("/api/session", ctx -> {
      final WebState.SessionSnapshot snapshot = this.state.snapshot(ctx.cookie(SESSION_COOKIE));
      if (snapshot.user() != null) {
        this.setSessionCookie(ctx, snapshot.user().id());
      }
      ctx.json(snapshot);
    });

    this.app.post("/api/session/login", ctx -> {
      final LoginRequest request = this.mapper.readValue(ctx.body(), LoginRequest.class);
      final WebState.SessionSnapshot snapshot = this.state.login(request.displayName());
      this.setSessionCookie(ctx, snapshot.user().id());
      ctx.json(snapshot);
    });

    this.app.ws("/ws", ws -> {
      ws.onConnect(ctx -> {
        final String sessionId = ctx.queryParam("sessionId");
        if (sessionId == null || sessionId.isBlank()) {
          ctx.send(this.json(new SocketEnvelope("error", Map.of("message", "Missing sessionId"))));
          ctx.closeSession();
          return;
        }

        final List<WebState.Push> pushes;
        try {
          pushes = this.state.attachSocket(sessionId, payload ->
              ctx.send(this.json(new SocketEnvelope("snapshot", payload))));
        } catch (final IllegalStateException e) {
          ctx.send(this.json(new SocketEnvelope("error", Map.of("message", e.getMessage()))));
          ctx.closeSession();
          return;
        }

        this.flush(pushes);
      });

      ws.onClose(ctx -> this.flush(this.state.detachSocket(ctx.queryParam("sessionId"))));

      ws.onMessage(ctx -> {
        final String sessionId = ctx.queryParam("sessionId");
        if (sessionId == null || sessionId.isBlank()) {
          ctx.send(this.json(new SocketEnvelope("error", Map.of("message", "Missing sessionId"))));
          return;
        }

        try {
          final JsonNode message = this.mapper.readTree(ctx.message());
          final String type = message.path("type").asText();
          final JsonNode payload = message.path("payload");
          this.flush(this.state.handleCommand(sessionId, type, payload));
        } catch (final IllegalStateException e) {
          ctx.send(this.json(new SocketEnvelope("error", Map.of("message", e.getMessage()))));
        }
      });
    });
  }

  private void flush(final List<WebState.Push> pushes) {
    pushes.forEach(push -> push.sink().send(push.snapshot()));
  }

  private void setSessionCookie(final io.javalin.http.Context ctx, final String sessionId) {
    ctx.res().addHeader(
        "Set-Cookie",
        SESSION_COOKIE + "=" + sessionId + "; Path=/; HttpOnly; Max-Age=" + COOKIE_MAX_AGE_SECONDS + "; SameSite=Lax");
  }

  public void start() {
    this.app.start("0.0.0.0", this.port);
  }

  public void stop() {
    this.state.shutdown();
    this.app.stop();
  }

  private String json(final Object value) {
    try {
      return this.mapper.writeValueAsString(value);
    } catch (final com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize websocket payload.", e);
    }
  }

  private record LoginRequest(String displayName) {}
  private record SocketEnvelope(String type, Object payload) {}
}
