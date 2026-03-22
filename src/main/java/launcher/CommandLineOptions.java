package launcher;

import org.apache.commons.cli.CommandLine;
import org.apache.commons.cli.DefaultParser;
import org.apache.commons.cli.HelpFormatter;
import org.apache.commons.cli.Option;
import org.apache.commons.cli.Options;
import org.apache.commons.cli.ParseException;

import java.net.InetSocketAddress;

public final class CommandLineOptions {
  private static final String DEFAULT_HOST = "127.0.0.1";
  private static final int DEFAULT_PORT = 43594;
  private static final int DEFAULT_WEB_PORT = 8080;

  private static final Option HELP =
      Option.builder("h").longOpt("help").desc("print this message").build();
  private static final Option HOST =
      Option.builder().longOpt("host").hasArg().argName("HOST").desc("game server host").build();
  private static final Option PORT =
      Option.builder().longOpt("port").hasArg().argName("PORT").desc("game server port").build();
  private static final Option LOCAL_SERVER =
      Option.builder().longOpt("local-server").desc("run a local game server").build();
  private static final Option HEADLESS =
      Option.builder().longOpt("headless").desc("only run the game server, not the client (implies --local-server)").build();
  private static final Option DEBUG_MODE =
      Option.builder().longOpt("debug").desc("enable debug mode").build();
  private static final Option WEB_PORT =
      Option.builder().longOpt("web-port").hasArg().argName("PORT").desc("browser API/websocket port").build();

  private static final Options OPTIONS = new Options()
      .addOption(HELP).addOption(HOST).addOption(PORT).addOption(WEB_PORT).addOption(LOCAL_SERVER).addOption(HEADLESS).addOption(DEBUG_MODE);

  public final InetSocketAddress serverAddress;
  public final int webPort;
  public final boolean debugMode;
  public final boolean runClient;
  public final boolean runServer;

  private CommandLineOptions(final InetSocketAddress serverAddress,
                             final int webPort,
                             final boolean debugMode,
                             final boolean runClient,
                             final boolean runServer) {
    this.serverAddress = serverAddress;
    this.webPort = webPort;
    this.debugMode = debugMode;
    this.runClient = runClient;
    this.runServer = runServer;
  }

  public static CommandLineOptions parse(final String[] args) {
    final CommandLine cmd;
    try {
      cmd = new DefaultParser().parse(OPTIONS, args);
    } catch (final ParseException e) {
      System.err.println(e.getMessage());
      printCommandLineUsage();
      System.exit(1);
      throw new Error("exit returned");
    }

    if (cmd.hasOption(HELP)) {
      printCommandLineUsage();
      System.exit(0);
      throw new Error("exit returned");
    }

    final int port;
    if (cmd.hasOption(PORT)) {
      try {
        port = Integer.parseInt(cmd.getOptionValue(PORT));
      } catch (final NumberFormatException e) {
        System.err.println("not a valid port: " + cmd.getOptionValue(PORT));
        System.exit(1);
        throw new Error("exit returned");
      }
    } else {
      port = DEFAULT_PORT;
    }

    final int webPort;
    if (cmd.hasOption(WEB_PORT)) {
      try {
        webPort = Integer.parseInt(cmd.getOptionValue(WEB_PORT));
      } catch (final NumberFormatException e) {
        System.err.println("not a valid web port: " + cmd.getOptionValue(WEB_PORT));
        System.exit(1);
        throw new Error("exit returned");
      }
    } else {
      webPort = DEFAULT_WEB_PORT;
    }

    return new CommandLineOptions(
        new InetSocketAddress(cmd.getOptionValue(HOST, DEFAULT_HOST), port),
        webPort,
        cmd.hasOption(DEBUG_MODE),
        !cmd.hasOption(HEADLESS),
        cmd.hasOption(LOCAL_SERVER) || cmd.hasOption(HEADLESS));
  }

  private static void printCommandLineUsage() {
    new HelpFormatter().printHelp("shatteredplans", OPTIONS);
  }
}
