package launcher.tools;

import funorb.audio.MidiPlayer;
import funorb.audio.RawSampleS8;
import funorb.audio.SampledAudioChannelS16;
import funorb.audio.SongData;
import funorb.audio.SoundLoader;
import funorb.cache.CacheWorker;
import funorb.cache.MasterIndexLoader;
import funorb.cache.ResourceLoader;
import funorb.shatteredplans.CacheFiles;
import funorb.shatteredplans.server.ShatteredPlansServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

public final class ExportOriginalAudio {
  private static final int MAX_LOAD_ATTEMPTS = 5;
  private static final int MUSIC_RENDER_LIMIT_FRAMES = SampledAudioChannelS16.SAMPLE_RATE * 60 * 12;
  private static final int MUSIC_RENDER_CHUNK_FRAMES = 2048;

  private static final List<SoundSpec> SOUND_EFFECTS = List.of(
      new SoundSpec("ship-selection", "shatteredplans_ship_selection", SoundKind.SYNTH),
      new SoundSpec("ship-move-order", "shatteredplans_ship_move_order", SoundKind.SYNTH),
      new SoundSpec("ship-attack-order", "shatteredplans_ship_attack_order", SoundKind.SYNTH),
      new SoundSpec("factory-noise", "shatteredplans_factory_noise", SoundKind.SYNTH),
      new SoundSpec("explosion", "shatteredplans_explosion", SoundKind.VORBIS),
      new SoundSpec("next-open", "shatteredplans_next_open", SoundKind.SYNTH),
      new SoundSpec("next-close", "shatteredplans_next_close", SoundKind.SYNTH)
  );

  private static final List<MusicSpec> MUSIC_TRACKS = List.of(
      new MusicSpec("intro", "shattered_plans_intro", true, 75),
      new MusicSpec("ingame", "shattered_plans_ingame", true, 120),
      new MusicSpec("ingame-two", "shattered_plans_ingame_two", true, 120),
      new MusicSpec("win", "shattered_plans_win", false, 28),
      new MusicSpec("lose", "shattered_plans_lose", false, 24)
  );

  private ExportOriginalAudio() {}

  public static void main(final String[] args) throws Exception {
    final Path outputDir = args.length > 0
        ? Paths.get(args[0]).toAbsolutePath().normalize()
        : Paths.get("src", "app", "public", "audio", "original").toAbsolutePath().normalize();
    exportAll(outputDir);
  }

  public static void exportAll(final Path outputDir) throws Exception {
    Files.createDirectories(outputDir);
    Files.createDirectories(outputDir.resolve("sfx"));
    Files.createDirectories(outputDir.resolve("music"));

    try (final CacheFiles cacheFiles = new CacheFiles();
         final CacheWorker cacheWorker = new CacheWorker(Thread::new)) {
      final MasterIndexLoader masterIndexLoader = new MasterIndexLoader(ShatteredPlansServer.PAGE_SOURCE, cacheWorker);
      if (!masterIndexLoader.loadIndex()) {
        throw new IllegalStateException("Failed to load the master resource index.");
      }

      final ResourceLoader sfxSynth = ResourceLoader.create(masterIndexLoader, cacheFiles, ResourceLoader.PageId.SHATTERED_PLANS_SFX_1);
      final ResourceLoader sfxVorbis = ResourceLoader.create(masterIndexLoader, cacheFiles, ResourceLoader.PageId.SHATTERED_PLANS_SFX_2);
      final ResourceLoader musicInstruments = ResourceLoader.create(masterIndexLoader, cacheFiles, ResourceLoader.PageId.SHATTERED_PLANS_MUSIC_1);
      final ResourceLoader musicSongs = ResourceLoader.create(masterIndexLoader, cacheFiles, ResourceLoader.PageId.SHATTERED_PLANS_MUSIC_2);

      ensureLoaded(sfxSynth, sfxVorbis, musicInstruments, musicSongs);

      final SoundLoader soundLoader = new SoundLoader(sfxSynth, sfxVorbis);
      exportSoundEffects(outputDir.resolve("sfx"), soundLoader);
      exportMusic(outputDir.resolve("music"), soundLoader, musicInstruments, musicSongs);
      writeManifest(outputDir);
    }
  }

  private static void ensureLoaded(final ResourceLoader... loaders) {
    for (int attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
      boolean loaded = true;
      for (final ResourceLoader loader : loaders) {
        loaded &= loader.loadAllGroups();
      }
      if (loaded) {
        return;
      }
    }
    throw new IllegalStateException("Failed to fully load one or more resource pages.");
  }

  private static void exportSoundEffects(final Path outputDir, final SoundLoader soundLoader) throws IOException {
    for (final SoundSpec spec : SOUND_EFFECTS) {
      final RawSampleS8 sample = switch (spec.kind) {
        case SYNTH -> soundLoader.loadSynth(spec.resourceName);
        case VORBIS -> soundLoader.loadVorbis(spec.resourceName);
      };
      if (sample == null) {
        throw new IllegalStateException("Missing sound effect: " + spec.resourceName);
      }

      final Path outputPath = outputDir.resolve(spec.fileName + ".wav");
      writeMonoWave(outputPath, sample.sampleRate, sample.data_s8);
    }
  }

  private static void exportMusic(final Path outputDir,
                                  final SoundLoader soundLoader,
                                  final ResourceLoader musicInstruments,
                                  final ResourceLoader musicSongs) throws IOException {
    for (final MusicSpec spec : MUSIC_TRACKS) {
      final SongData song = SongData.load(musicSongs, spec.resourceName);
      if (song == null) {
        throw new IllegalStateException("Missing music track: " + spec.resourceName);
      }

      final byte[] pcm = renderSong(soundLoader, musicInstruments, song, spec.renderSeconds);
      final Path outputPath = outputDir.resolve(spec.fileName + ".wav");
      writeStereoWave(outputPath, SampledAudioChannelS16.SAMPLE_RATE, pcm);
    }
  }

  private static byte[] renderSong(final SoundLoader soundLoader,
                                   final ResourceLoader musicInstruments,
                                   final SongData song,
                                   final int renderSeconds) {
    final MidiPlayer player = new MidiPlayer();
    player.initialize();
    player.setAmp_p8(256);
    player.loadNoteSamplesForSong(soundLoader, musicInstruments, song);
    player.changeSong(song, false);
    player.initChGlobalAmp();
    player.initMicrosecondsPerSecond();

    final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
    final int totalFrames = Math.min(MUSIC_RENDER_LIMIT_FRAMES, SampledAudioChannelS16.SAMPLE_RATE * renderSeconds);
    if (totalFrames >= MUSIC_RENDER_LIMIT_FRAMES) {
      throw new IllegalStateException("Requested music render duration exceeded the safety limit.");
    }

    int framesRendered = 0;
    while (framesRendered < totalFrames) {
      final int chunkFrames = Math.min(MUSIC_RENDER_CHUNK_FRAMES, totalFrames - framesRendered);
      final int[] mixP8 = new int[chunkFrames * 2];
      player.processAndWrite(mixP8, 0, chunkFrames);

      for (int index = 0; index < mixP8.length; index++) {
        final short sample = toPcm16(mixP8[index]);
        pcm.write(sample & 0xff);
        pcm.write((sample >>> 8) & 0xff);
      }

      framesRendered += chunkFrames;
    }
    return pcm.toByteArray();
  }

  private static short toPcm16(final int sampleP8) {
    int clipped = sampleP8;
    if (((clipped + 0x80_00_00) & 0xff_00_00_00) != 0) {
      clipped = 0x7f_ff_ff ^ (clipped >> 31);
    }
    return (short) (clipped >> 8);
  }

  private static void writeMonoWave(final Path outputPath, final int sampleRate, final byte[] sampleData) throws IOException {
    final byte[] pcm = new byte[sampleData.length * 2];
    for (int index = 0; index < sampleData.length; index++) {
      final short sample = (short) (sampleData[index] << 8);
      pcm[index * 2] = (byte) (sample & 0xff);
      pcm[index * 2 + 1] = (byte) ((sample >>> 8) & 0xff);
    }
    writeWave(outputPath, sampleRate, (short) 1, pcm);
  }

  private static void writeStereoWave(final Path outputPath, final int sampleRate, final byte[] pcm) throws IOException {
    writeWave(outputPath, sampleRate, (short) 2, pcm);
  }

  private static void writeWave(final Path outputPath,
                                final int sampleRate,
                                final short channels,
                                final byte[] pcm) throws IOException {
    Files.createDirectories(outputPath.getParent());
    final int byteRate = sampleRate * channels * 2;
    final short blockAlign = (short) (channels * 2);

    try (final ByteArrayOutputStream wav = new ByteArrayOutputStream(44 + pcm.length)) {
      writeAscii(wav, "RIFF");
      writeIntLE(wav, 36 + pcm.length);
      writeAscii(wav, "WAVE");
      writeAscii(wav, "fmt ");
      writeIntLE(wav, 16);
      writeShortLE(wav, (short) 1);
      writeShortLE(wav, channels);
      writeIntLE(wav, sampleRate);
      writeIntLE(wav, byteRate);
      writeShortLE(wav, blockAlign);
      writeShortLE(wav, (short) 16);
      writeAscii(wav, "data");
      writeIntLE(wav, pcm.length);
      wav.write(pcm);
      Files.write(outputPath, wav.toByteArray());
    }
  }

  private static void writeManifest(final Path outputDir) throws IOException {
    final StringBuilder json = new StringBuilder();
    json.append("{\n");
    json.append("  \"sfx\": {\n");
    for (int index = 0; index < SOUND_EFFECTS.size(); index++) {
      final SoundSpec spec = SOUND_EFFECTS.get(index);
      json.append("    \"").append(spec.fileName).append("\": \"/audio/original/sfx/")
          .append(spec.fileName).append(".wav\"");
      json.append(index + 1 < SOUND_EFFECTS.size() ? ",\n" : "\n");
    }
    json.append("  },\n");
    json.append("  \"music\": {\n");
    for (int index = 0; index < MUSIC_TRACKS.size(); index++) {
      final MusicSpec spec = MUSIC_TRACKS.get(index);
      json.append("    \"").append(spec.fileName).append("\": {\n");
      json.append("      \"src\": \"/audio/original/music/").append(spec.fileName).append(".wav\",\n");
      json.append("      \"loop\": ").append(spec.loop).append("\n");
      json.append("    }");
      json.append(index + 1 < MUSIC_TRACKS.size() ? ",\n" : "\n");
    }
    json.append("  }\n");
    json.append("}\n");
    Files.writeString(outputDir.resolve("manifest.json"), json.toString(), StandardCharsets.UTF_8);
  }

  private static void writeAscii(final ByteArrayOutputStream out, final String value) {
    out.writeBytes(value.getBytes(StandardCharsets.US_ASCII));
  }

  private static void writeIntLE(final ByteArrayOutputStream out, final int value) {
    out.write(value & 0xff);
    out.write((value >>> 8) & 0xff);
    out.write((value >>> 16) & 0xff);
    out.write((value >>> 24) & 0xff);
  }

  private static void writeShortLE(final ByteArrayOutputStream out, final short value) {
    out.write(value & 0xff);
    out.write((value >>> 8) & 0xff);
  }

  private record SoundSpec(String fileName, String resourceName, SoundKind kind) {}

  private record MusicSpec(String fileName, String resourceName, boolean loop, int renderSeconds) {}

  private enum SoundKind {
    SYNTH,
    VORBIS
  }
}
