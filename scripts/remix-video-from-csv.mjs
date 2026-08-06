#!/usr/bin/env node

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const REQUIRED_COLUMNS = [
  'node_id',
  'sample_name',
  'start_ms',
  'end_ms',
  'speed',
  'volume',
  'attack_ms',
  'release_ms',
  'trigger_time_ms',
];

const GRAYSCALE_RED = 0.2126;
const GRAYSCALE_GREEN = 0.7152;
const GRAYSCALE_BLUE = 0.0722;

const HELP = `Usage:
  node scripts/remix-video-from-csv.mjs [options] <events.csv>

Options:
  -o, --output <file>             Output path (default: <csv-stem>-remixed.mp4)
      --final-duration-ms <ms>    Duration of the final chop
      --samples-dir <directory>   Sample directory (default: samples)
      --sample-name <name>        Use only rows with this sample_name
      --pre <seconds>             Add silent video before every clip
      --post <seconds>            Add silent video after every clip
      --faded-extensions          Make pre/post grayscale at 50% opacity
      --overlap-opacity           Mix overlaps; layer newer video at 50%
      --overlap-split             Mix overlaps; show equal-width video slices
      --overlap-grid              Mix overlaps; reflow video in a dynamic grid
      --overwrite                 Replace an existing output file
  -h, --help                      Show this help

The script requires ffmpeg and ffprobe. It loads each CSV sample_name from the
samples directory, ignoring samples without a video stream. For every remaining
row it takes the corresponding video
region, applies the recorded direction, speed, volume, attack, and release,
and joins the chops in trigger order. Each chop
lasts until the next trigger. When --final-duration-ms is omitted, the final
chop uses the median preceding trigger interval (or its full region if it is
the only row). By default a new trigger cuts off the previous clip. The
overlap modes instead keep every voice audible until its source region ends.
`;

main().catch((error) => {
  process.stderr.write(`remix-video: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const csvPath = resolve(options.csvPath);
  const samplesDirectory = resolve(options.samplesDirectory);
  await assertFile(csvPath, 'CSV');

  const outputPath = resolve(options.outputPath ?? defaultOutputPath(csvPath));
  if (!options.overwrite && await fileExists(outputPath)) {
    throw new Error(`Output already exists: ${outputPath}\nPass --overwrite to replace it.`);
  }

  const rows = parseEventRows(await readFile(csvPath, 'utf8'));
  const { events: selectedEvents, sources } = await resolveEventSources(
    rows,
    samplesDirectory,
    options.sampleName,
  );
  if (sources.some((source) => source.path === outputPath)) {
    throw new Error('The output path must not replace a source video.');
  }
  const events = skipInvalidSourceRegions(selectedEvents);
  if (events.length === 0) {
    throw new Error('The CSV contains no playback events with a usable source region.');
  }
  const outputMedia = sources[0].media;

  const segments = options.overlapMode
    ? null
    : makeSegments(events, options.finalDurationMs, options.preSeconds, options.postSeconds);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'visual-fm-video-remix-'));
  const filterPath = join(temporaryDirectory, 'filter-complex.txt');

  try {
    const plan = options.overlapMode
      ? makeOverlapFilterGraph(
        events,
        options.finalDurationMs,
        outputMedia,
        options.overlapMode,
        sources,
        options.preSeconds,
        options.postSeconds,
        options.fadedExtensions,
      )
      : makeFilterGraph(segments, outputMedia, sources, options.fadedExtensions);
    await writeFile(filterPath, plan.filter);

    const ffmpegArguments = [
      '-hide_banner',
      options.overwrite ? '-y' : '-n',
      ...plan.inputArguments,
      '-filter_complex_threads', '4',
      '-filter_complex_script', filterPath,
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath,
    ];
    await run('ffmpeg', ffmpegArguments);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  process.stdout.write(
    `Created ${outputPath}\n`
    + `Used ${events.length} event${events.length === 1 ? '' : 's'} from `
    + `${sources.length} video${sources.length === 1 ? '' : 's'}`
    + `${options.overlapMode ? ` in overlap-${options.overlapMode} mode` : ''}.\n`,
  );
}

function parseArguments(arguments_) {
  const positional = [];
  const options = {
    help: false,
    overwrite: false,
    outputPath: null,
    finalDurationMs: null,
    samplesDirectory: 'samples',
    sampleName: null,
    preSeconds: 0,
    postSeconds: 0,
    fadedExtensions: false,
    overlapMode: null,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '-h' || argument === '--help') {
      options.help = true;
    } else if (argument === '--overwrite') {
      options.overwrite = true;
    } else if (argument === '-o' || argument === '--output') {
      options.outputPath = requiredOptionValue(arguments_, ++index, argument);
    } else if (argument === '--final-duration-ms') {
      const value = Number(requiredOptionValue(arguments_, ++index, argument));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--final-duration-ms must be a positive number.');
      }
      options.finalDurationMs = value;
    } else if (argument === '--samples-dir') {
      options.samplesDirectory = requiredOptionValue(arguments_, ++index, argument);
    } else if (argument === '--sample-name') {
      options.sampleName = requiredOptionValue(arguments_, ++index, argument);
    } else if (argument === '--pre' || argument === '--post') {
      const value = Number(requiredOptionValue(arguments_, ++index, argument));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${argument} must be a non-negative number of seconds.`);
      }
      options[argument === '--pre' ? 'preSeconds' : 'postSeconds'] = value;
    } else if (argument === '--faded-extensions') {
      options.fadedExtensions = true;
    } else if (
      argument === '--overlap-opacity'
      || argument === '--overlap-split'
      || argument === '--overlap-grid'
    ) {
      const overlapMode = argument.slice('--overlap-'.length);
      if (options.overlapMode && options.overlapMode !== overlapMode) {
        throw new Error('The overlap options cannot be used together.');
      }
      options.overlapMode = overlapMode;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}\n\n${HELP}`);
    } else {
      positional.push(argument);
    }
  }

  if (!options.help && positional.length !== 1) {
    throw new Error(`Expected one CSV file.\n\n${HELP}`);
  }
  return {
    ...options,
    csvPath: positional[0],
  };
}

function requiredOptionValue(arguments_, index, option) {
  const value = arguments_[index];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
  return value;
}

function defaultOutputPath(csvPath) {
  const extension = extname(csvPath);
  return join(dirname(csvPath), `${basename(csvPath, extension)}-remixed.mp4`);
}

async function assertFile(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch {
    throw new Error(`${label} file not found: ${path}`);
  }
  if (!details.isFile()) throw new Error(`${label} path is not a file: ${path}`);
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseEventRows(csvText) {
  const records = parseCsv(csvText.replace(/^\uFEFF/, ''));
  if (records.length === 0) throw new Error('The CSV is empty.');

  const header = records[0].map((value) => value.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }

  return records.slice(1).filter((record) => record.some((value) => value.trim() !== '')).map((record, index) => {
    const row = Object.fromEntries(header.map((column, columnIndex) => [column, record[columnIndex] ?? '']));
    const numeric = (column) => {
      const value = Number(row[column]);
      if (!Number.isFinite(value)) throw new Error(`CSV row ${index + 2} has an invalid ${column}.`);
      return value;
    };
    const event = {
      captureOrder: index,
      nodeId: row.node_id,
      sampleName: row.sample_name,
      startMs: numeric('start_ms'),
      endMs: numeric('end_ms'),
      speed: numeric('speed'),
      volume: numeric('volume'),
      attackMs: numeric('attack_ms'),
      releaseMs: numeric('release_ms'),
      triggerTimeMs: numeric('trigger_time_ms'),
    };
    if (event.startMs < 0 || event.endMs < 0 || event.triggerTimeMs < 0) {
      throw new Error(`CSV row ${index + 2} contains a negative time.`);
    }
    if (event.speed === 0) throw new Error(`CSV row ${index + 2} has zero speed and cannot produce a video chop.`);
    return event;
  });
}

function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n') {
      record.push(field.replace(/\r$/, ''));
      records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field.');
  if (field !== '' || record.length > 0) {
    record.push(field.replace(/\r$/, ''));
    records.push(record);
  }
  return records;
}

async function resolveEventSources(rows, samplesDirectory, requestedSampleName) {
  const selected = requestedSampleName
    ? rows.filter((row) => row.sampleName === requestedSampleName)
    : rows;
  if (selected.length === 0) {
    throw new Error(requestedSampleName
      ? `No CSV rows match sample_name "${requestedSampleName}".`
      : 'The CSV contains no playback events.');
  }

  const sampleNames = [...new Set(selected.map((event) => basename(event.sampleName)))];
  if (sampleNames.some((name) => name.length === 0)) {
    throw new Error('The CSV contains an empty sample_name.');
  }
  const probedSources = await Promise.all(sampleNames.map(async (sampleName) => {
    const path = join(samplesDirectory, sampleName);
    await assertFile(path, `sample "${sampleName}"`);
    const media = await probeMedia(path);
    if (!media.hasVideo) {
      process.stderr.write(`remix-video: skipping sample "${sampleName}" because it has no video stream.\n`);
      return null;
    }
    if (!media.hasAudio) throw new Error(`Sample "${sampleName}" has no audio stream.`);
    return { sampleName, path, media };
  }));
  const sources = probedSources
    .filter((source) => source !== null)
    .map((source, index) => ({ ...source, index }));
  if (sources.length === 0) {
    throw new Error('The selected CSV rows contain no samples with a video stream.');
  }
  const sourceByName = new Map(sources.map((source) => [source.sampleName, source]));
  const events = sortEvents(selected).flatMap((event) => {
    const source = sourceByName.get(basename(event.sampleName));
    return source ? [{ ...event, sourceIndex: source.index, media: source.media }] : [];
  });
  return { events, sources };
}

function sortEvents(events) {
  return [...events].sort((left, right) => (
    left.triggerTimeMs - right.triggerTimeMs || left.captureOrder - right.captureOrder
  ));
}

function skipInvalidSourceRegions(events) {
  return events.filter((event) => {
    const lowMs = Math.max(0, Math.min(event.startMs, event.endMs));
    const highMs = Math.min(event.media.durationSeconds * 1000, Math.max(event.startMs, event.endMs));
    if (highMs > lowMs) return true;
    process.stderr.write(
      `remix-video: skipping CSV row ${event.captureOrder + 2}; it selects an empty or out-of-range source region.\n`,
    );
    return false;
  });
}

function makeSegments(events, finalDurationMs, preSeconds, postSeconds) {
  const positiveIntervals = [];
  for (let index = 1; index < events.length; index += 1) {
    const interval = events[index].triggerTimeMs - events[index - 1].triggerTimeMs;
    if (interval > 0) positiveIntervals.push(interval);
  }

  let inferredFinalDurationMs = finalDurationMs;
  if (inferredFinalDurationMs === null && positiveIntervals.length > 0) {
    inferredFinalDurationMs = median(positiveIntervals);
  }

  const segments = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const next = events[index + 1];
    let durationMs = next ? next.triggerTimeMs - event.triggerTimeMs : inferredFinalDurationMs;
    if (durationMs === null) {
      durationMs = Math.abs(event.endMs - event.startMs) / Math.abs(event.speed);
    }
    if (durationMs <= 0) {
      process.stderr.write(`remix-video: skipping simultaneous zero-length event at CSV row ${event.captureOrder + 2}.\n`);
      continue;
    }

    const lowMs = Math.max(0, Math.min(event.startMs, event.endMs));
    const highMs = Math.min(event.media.durationSeconds * 1000, Math.max(event.startMs, event.endMs));
    if (highMs <= lowMs) {
      throw new Error(`CSV row ${event.captureOrder + 2} selects an empty or out-of-range source region.`);
    }

    const sourceDirection = event.endMs >= event.startMs ? 1 : -1;
    const playbackDirection = sourceDirection * Math.sign(event.speed);
    const availableOutputMs = (highMs - lowMs) / Math.abs(event.speed);
    const contentDurationMs = Math.min(durationMs, availableOutputMs);
    const sourceNeededMs = contentDurationMs * Math.abs(event.speed);
    const audioSourceStartMs = playbackDirection > 0 ? lowMs : highMs - sourceNeededMs;
    const audioSourceEndMs = playbackDirection > 0 ? lowMs + sourceNeededMs : highMs;
    const sourceRate = Math.abs(event.speed);
    const availablePreSourceMs = playbackDirection > 0
      ? audioSourceStartMs
      : event.media.durationSeconds * 1000 - audioSourceEndMs;
    const availablePostSourceMs = playbackDirection > 0
      ? event.media.durationSeconds * 1000 - audioSourceEndMs
      : audioSourceStartMs;
    const preSourceMs = Math.min(preSeconds * 1000 * sourceRate, availablePreSourceMs);
    const postSourceMs = Math.min(postSeconds * 1000 * sourceRate, availablePostSourceMs);
    const actualPreSeconds = preSourceMs / sourceRate / 1000;
    const actualPostSeconds = postSourceMs / sourceRate / 1000;
    const sourceStartMs = playbackDirection > 0
      ? audioSourceStartMs - preSourceMs
      : audioSourceStartMs - postSourceMs;
    const sourceEndMs = playbackDirection > 0
      ? audioSourceEndMs + postSourceMs
      : audioSourceEndMs + preSourceMs;
    segments.push({
      ...event,
      durationSeconds: actualPreSeconds + durationMs / 1000 + actualPostSeconds,
      contentDurationSeconds: contentDurationMs / 1000,
      audioSourceStartSeconds: audioSourceStartMs / 1000,
      audioSourceEndSeconds: audioSourceEndMs / 1000,
      sourceStartSeconds: sourceStartMs / 1000,
      sourceEndSeconds: sourceEndMs / 1000,
      preSeconds: actualPreSeconds,
      postSeconds: actualPostSeconds,
      reverse: playbackDirection < 0,
    });
  }
  if (segments.length === 0) throw new Error('All selected events have zero duration.');
  return segments;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function probeMedia(videoPath) {
  const output = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,sample_rate,width,height,avg_frame_rate',
    '-of', 'json',
    videoPath,
  ], true);
  let probe;
  try {
    probe = JSON.parse(output);
  } catch {
    throw new Error('ffprobe returned invalid media information.');
  }
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const video = streams.find((stream) => stream.codec_type === 'video');
  const durationSeconds = Number(probe.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Could not determine the source video duration.');
  }
  return {
    durationSeconds,
    hasVideo: streams.some((stream) => stream.codec_type === 'video'),
    hasAudio: Boolean(audio),
    audioSampleRate: Number(audio?.sample_rate) || 48_000,
    width: Number(video?.width) || 1920,
    height: Number(video?.height) || 1080,
    frameRate: validFrameRate(video?.avg_frame_rate) ? video.avg_frame_rate : '30',
  };
}

function validFrameRate(value) {
  if (typeof value !== 'string' || !/^\d+(?:\/\d+)?$/.test(value)) return false;
  const [numerator, denominator = '1'] = value.split('/').map(Number);
  return numerator > 0 && denominator > 0;
}

function makeOverlapFilterGraph(
  events,
  finalDurationMs,
  media,
  mode,
  sources,
  preSeconds,
  postSeconds,
  fadedExtensions,
) {
  const prepared = prepareOverlapEvents(events, preSeconds, postSeconds);
  const audioOutputDurationSeconds = overlapOutputDurationSeconds(prepared, finalDurationMs);
  const outputDurationSeconds = audioOutputDurationSeconds + prepared.at(-1).videoPostSeconds;
  const timelineEvents = prepared.filter((event) => event.triggerSeconds < outputDurationSeconds);
  if (timelineEvents.length === 0) throw new Error('No playback event begins before the output ends.');
  warnAboutOverlapComplexity(timelineEvents, outputDurationSeconds);

  const intervals = makeOverlapIntervals(
    timelineEvents,
    outputDurationSeconds,
    fadedExtensions,
    media.frameRate,
  );
  const lines = [];
  const boundedInputs = makeBoundedInputs(
    timelineEvents,
    sources,
    (event) => event.videoLowSeconds,
    (event) => event.videoHighSeconds,
  );
  const eventVideoInputs = allocateInputConsumers(
    boundedInputs.inputs,
    'v',
    'oveventin',
    lines,
  );
  const audioInputs = allocateInputConsumers(
    boundedInputs.inputs,
    'a',
    'oain',
    lines,
  );

  if (mode === 'grid') {
    composeContinuousGrid(
      lines,
      eventVideoInputs,
      timelineEvents,
      intervals,
      outputDurationSeconds,
      media,
      boundedInputs.inputs,
      fadedExtensions,
    );
  } else {
    const preparedVideoByEvent = new Map();
    const videoPieceEvents = intervals.flatMap((interval) => interval.active);
    const visibleVideoEvents = new Set(videoPieceEvents);
    timelineEvents.forEach((event, index) => {
      if (!visibleVideoEvents.has(event)) {
        lines.push(`${bracket(eventVideoInputs[index])}nullsink`);
        return;
      }
      const label = `ovprepared${index}`;
      const sourceInput = boundedInputs.inputs[index];
      lines.push(makeOverlapVideoVoice(
        eventVideoInputs[index],
        label,
        event,
        outputDurationSeconds,
        media,
        sourceInput.startSeconds,
      ));
      preparedVideoByEvent.set(event, { video: label });
    });
    const videoInputs = allocateInputConsumers(
      videoPieceEvents.map((event) => preparedVideoByEvent.get(event)),
      'v',
      'ovin',
      lines,
    );
    let videoInputIndex = 0;
    intervals.forEach((interval, intervalIndex) => {
      const pieceLabels = interval.active.map((event, activeIndex) => {
        const input = videoInputs[videoInputIndex];
        videoInputIndex += 1;
        const label = `opiece${intervalIndex}_${activeIndex}`;
        lines.push(makeOverlapVideoPiece(
          input,
          label,
          event,
          interval,
          media,
          fadedExtensions,
          null,
        ));
        return label;
      });
      if (mode === 'opacity') {
        composeOpacityInterval(lines, pieceLabels, interval, intervalIndex, media);
      } else {
        composeSplitInterval(lines, pieceLabels, interval, intervalIndex, media);
      }
      lines.push(
        `[ointerval${intervalIndex}]fps=${media.frameRate}:start_time=0:round=near,`
        + `tpad=stop_mode=clone:stop_duration=${decimal(interval.duration)},`
        + `trim=duration=${decimal(interval.duration)},settb=AVTB,`
        + `setpts=PTS-STARTPTS[otimed${intervalIndex}]`,
      );
      lines.push(
        `anullsrc=r=${media.audioSampleRate}:cl=stereo,`
        + `atrim=duration=${decimal(interval.duration)},asetpts=PTS-STARTPTS[oclock${intervalIndex}]`,
      );
    });

    const intervalInputs = intervals
      .map((_, index) => `[otimed${index}][oclock${index}]`)
      .join('');
    lines.push(`${intervalInputs}concat=n=${intervals.length}:v=1:a=1[orawv][oclockout]`);
    lines.push('[oclockout]anullsink');
    const videoOutputDurationSeconds = intervals.at(-1).end;
    lines.push(
      `[orawv]fps=${media.frameRate},`
      + `tpad=stop_mode=clone:stop_duration=${decimal(frameDurationSeconds(media.frameRate))},`
      + `trim=duration=${decimal(videoOutputDurationSeconds)},`
      + 'settb=AVTB,setpts=PTS-STARTPTS[outv]',
    );
  }

  timelineEvents.forEach((event, index) => {
    lines.push(makeOverlapAudioVoice(
      audioInputs[index],
      `ovoice${index}`,
      event,
      audioOutputDurationSeconds,
      media.audioSampleRate,
      boundedInputs.inputs[index].startSeconds,
    ));
  });

  // Keep the mixer clock alive even when every delayed event voice initially
  // reports EOF. `apad` cannot create output when its upstream filter has not
  // emitted a first frame, which otherwise produces only AAC encoder padding.
  lines.push(
    `anullsrc=r=${media.audioSampleRate}:cl=stereo,`
    + `atrim=duration=${decimal(outputDurationSeconds)},`
    + 'asetpts=PTS-STARTPTS[oaudiobed]',
  );
  const voiceInputs = timelineEvents.map((_, index) => `[ovoice${index}]`).join('');
  lines.push(
    `${voiceInputs}[oaudiobed]amix=inputs=${timelineEvents.length + 1}:`
    + 'duration=longest:normalize=0:dropout_transition=0,'
    + `apad=pad_dur=${decimal(outputDurationSeconds)},`
    + `atrim=duration=${decimal(outputDurationSeconds)},asetpts=PTS-STARTPTS[outa]`,
  );
  return {
    filter: `${lines.join(';\n')}\n`,
    inputArguments: boundedInputs.arguments,
  };
}

function prepareOverlapEvents(events, preSeconds, postSeconds) {
  return events.map((event) => {
    const source = sourceRegion(event);
    const triggerSeconds = event.triggerTimeMs / 1000;
    const availablePreSeconds = source.reverse
      ? event.media.durationSeconds - source.highSeconds
      : source.lowSeconds;
    const availablePostSeconds = source.reverse
      ? source.lowSeconds
      : event.media.durationSeconds - source.highSeconds;
    const actualPreSeconds = Math.min(preSeconds, availablePreSeconds / source.speed, triggerSeconds);
    const actualPostSeconds = Math.min(postSeconds, availablePostSeconds / source.speed);
    const videoLowSeconds = source.reverse
      ? source.lowSeconds - actualPostSeconds * source.speed
      : source.lowSeconds - actualPreSeconds * source.speed;
    const videoHighSeconds = source.reverse
      ? source.highSeconds + actualPreSeconds * source.speed
      : source.highSeconds + actualPostSeconds * source.speed;
    return {
      ...event,
      ...source,
      triggerSeconds,
      contentDurationSeconds: (source.highSeconds - source.lowSeconds) / source.speed,
      videoLowSeconds,
      videoHighSeconds,
      videoStartSeconds: triggerSeconds - actualPreSeconds,
      videoPostSeconds: actualPostSeconds,
      videoDurationSeconds: actualPreSeconds
        + (source.highSeconds - source.lowSeconds) / source.speed
        + actualPostSeconds,
    };
  });
}

function sourceRegion(event) {
  const lowSeconds = Math.max(0, Math.min(event.startMs, event.endMs) / 1000);
  const highSeconds = Math.min(
    event.media.durationSeconds,
    Math.max(event.startMs, event.endMs) / 1000,
  );
  if (highSeconds <= lowSeconds) {
    throw new Error(`CSV row ${event.captureOrder + 2} selects an empty or out-of-range source region.`);
  }
  const speed = Math.abs(event.speed);
  const sourceDirection = event.endMs >= event.startMs ? 1 : -1;
  return {
    lowSeconds,
    highSeconds,
    speed,
    reverse: sourceDirection * Math.sign(event.speed) < 0,
  };
}

function overlapOutputDurationSeconds(events, finalDurationMs) {
  const last = events.at(-1);
  const positiveIntervals = [];
  for (let index = 1; index < events.length; index += 1) {
    const interval = events[index].triggerTimeMs - events[index - 1].triggerTimeMs;
    if (interval > 0) positiveIntervals.push(interval);
  }
  const finalTailMs = finalDurationMs
    ?? (positiveIntervals.length > 0 ? median(positiveIntervals) : last.contentDurationSeconds * 1000);
  return last.triggerSeconds + finalTailMs / 1000;
}

function warnAboutOverlapComplexity(events, outputDurationSeconds) {
  const boundaries = [];
  let layerSeconds = 0;
  events.forEach((event) => {
    const start = Math.max(0, event.videoStartSeconds);
    const end = Math.min(
      outputDurationSeconds,
      event.videoStartSeconds + event.videoDurationSeconds,
    );
    if (end <= start) return;
    layerSeconds += end - start;
    boundaries.push([start, 1], [end, -1]);
  });
  boundaries.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let active = 0;
  let maximumActive = 0;
  boundaries.forEach(([, change]) => {
    active += change;
    maximumActive = Math.max(maximumActive, active);
  });
  const averageLayers = layerSeconds / outputDurationSeconds;
  if (maximumActive <= 16 && averageLayers <= 8) return;
  process.stderr.write(
    `remix-video: warning: overlap composition reaches ${maximumActive} simultaneous video voices `
    + `and ${decimal(layerSeconds)} layer-seconds across ${decimal(outputDurationSeconds)} seconds `
    + `of output (average ${decimal(averageLayers)} layers); feedback-expanded source regions may `
    + 'take substantially longer to render.\n',
  );
}

function makeOverlapIntervals(events, outputDurationSeconds, fadedExtensions, frameRate) {
  const frameDuration = frameDurationSeconds(frameRate);
  const videoOutputDurationSeconds = Math.ceil(outputDurationSeconds / frameDuration) * frameDuration;
  const boundaries = [0, videoOutputDurationSeconds];
  events.forEach((event) => {
    const end = Math.min(
      outputDurationSeconds,
      event.videoStartSeconds + event.videoDurationSeconds,
    );
    if (event.videoStartSeconds > 0 && event.videoStartSeconds < outputDurationSeconds) {
      boundaries.push(event.videoStartSeconds);
    }
    if (end > 0 && end < outputDurationSeconds) boundaries.push(end);
    if (fadedExtensions) {
      const contentEnd = event.triggerSeconds + event.contentDurationSeconds;
      if (event.triggerSeconds > 0 && event.triggerSeconds < outputDurationSeconds) {
        boundaries.push(event.triggerSeconds);
      }
      if (contentEnd > 0 && contentEnd < outputDurationSeconds) boundaries.push(contentEnd);
    }
  });
  const quantizedBoundaries = boundaries.map((value) => Math.min(
    videoOutputDurationSeconds,
    Math.max(0, Math.round(value / frameDuration) * frameDuration),
  ));
  const sorted = [...new Set(quantizedBoundaries.map((value) => decimal(value)))].map(Number)
    .sort((left, right) => left - right);

  return sorted.slice(0, -1).map((start, index) => {
    const end = sorted[index + 1];
    const sampleTime = (start + end) / 2;
    return {
      start,
      end,
      duration: end - start,
      active: events.filter((event) => (
        event.videoStartSeconds <= sampleTime
        && event.videoStartSeconds + event.videoDurationSeconds > sampleTime
      )),
    };
  }).filter((interval) => interval.duration > 0);
}

function frameDurationSeconds(frameRate) {
  const [numerator, denominator = '1'] = frameRate.split('/').map(Number);
  return denominator / numerator;
}

function makeOverlapVideoPiece(
  input,
  output,
  event,
  interval,
  media,
  fadedExtensions,
  gridCell,
) {
  const elapsedStart = Math.max(0, interval.start - event.videoStartSeconds);
  const elapsedEnd = Math.min(
    event.videoDurationSeconds,
    interval.end - event.videoStartSeconds,
  );
  const contentEnd = event.triggerSeconds + event.contentDurationSeconds;
  const isExtension = fadedExtensions && (
    interval.end <= event.triggerSeconds + 0.000001
    || interval.start >= contentEnd - 0.000001
  );
  const filters = [
    `trim=start=${decimal(elapsedStart)}:end=${decimal(elapsedEnd)}`,
    'setpts=PTS-STARTPTS',
    `tpad=stop_mode=clone:stop_duration=${decimal(interval.duration)}`,
    `trim=duration=${decimal(interval.duration)}`,
    ...(gridCell
      ? [
        `scale=w=${gridCell.width}:h=${gridCell.height}:`
          + 'force_original_aspect_ratio=increase:flags=lanczos',
        `crop=w=${gridCell.width}:h=${gridCell.height}`,
      ]
      : [`scale=w=${media.width}:h=${media.height}:flags=lanczos`]),
    'settb=AVTB',
    'setpts=PTS-STARTPTS',
    'setsar=1',
    ...(gridCell
      ? [
        'format=yuv420p',
        ...(isExtension ? [fadedExtensionYuvOnBlackFilter()] : []),
      ]
      : [
        'format=rgba',
        ...(isExtension ? [fadedExtensionAlphaFilter()] : []),
      ]),
  ];
  return `${bracket(input)}${filters.join(',')}[${output}]`;
}

function makeOverlapVideoVoice(
  input,
  output,
  event,
  outputDurationSeconds,
  media,
  inputStartSeconds,
) {
  const availableDuration = Math.min(
    event.videoDurationSeconds,
    outputDurationSeconds - event.videoStartSeconds,
  );
  const sourceNeeded = availableDuration * event.speed;
  const sourceStart = event.reverse
    ? event.videoHighSeconds - sourceNeeded
    : event.videoLowSeconds;
  const sourceEnd = event.reverse
    ? event.videoHighSeconds
    : event.videoLowSeconds + sourceNeeded;
  const filters = [
    `trim=start=${decimal(sourceStart - inputStartSeconds)}:`
      + `end=${decimal(sourceEnd - inputStartSeconds)}`,
    'setpts=PTS-STARTPTS',
    ...(event.reverse ? ['reverse'] : []),
    `setpts=PTS/${decimal(event.speed)}`,
    `fps=${media.frameRate}:start_time=0:round=near`,
    `tpad=stop_mode=clone:stop_duration=${decimal(availableDuration)}`,
    `trim=duration=${decimal(availableDuration)}`,
    'settb=AVTB',
    'setpts=PTS-STARTPTS',
  ];
  return `${bracket(input)}${filters.join(',')}[${output}]`;
}

function composeOpacityInterval(lines, pieces, interval, intervalIndex, media) {
  const output = `ointerval${intervalIndex}`;
  if (pieces.length === 0) {
    lines.push(blackInterval(output, interval.duration, media));
    return;
  }

  const background = `opacitybase${intervalIndex}`;
  lines.push(blackInterval(background, interval.duration, media, 'rgba'));
  let base = background;
  pieces.forEach((piece, index) => {
    let foreground = piece;
    if (index > 0) {
      const translucent = `otranslucent${intervalIndex}_${index}`;
      lines.push(`[${piece}]colorchannelmixer=aa=0.5[${translucent}]`);
      foreground = translucent;
    }
    const composite = index === pieces.length - 1 ? output : `ocomposite${intervalIndex}_${index}`;
    lines.push(
      `[${base}][${foreground}]overlay=shortest=1:format=auto,`
      + `${index === pieces.length - 1 ? 'format=yuv420p,' : ''}`
      + `setsar=1[${composite}]`,
    );
    base = composite;
  });
}

function composeSplitInterval(lines, pieces, interval, intervalIndex, media) {
  const output = `ointerval${intervalIndex}`;
  if (pieces.length === 0) {
    lines.push(blackInterval(output, interval.duration, media));
    return;
  }

  const background = `osplitbase${intervalIndex}`;
  lines.push(blackInterval(background, interval.duration, media, 'rgba'));
  let base = background;
  pieces.forEach((piece, index) => {
    const x = Math.floor(media.width * index / pieces.length);
    const nextX = Math.floor(media.width * (index + 1) / pieces.length);
    const width = nextX - x;
    const cropped = `ocrop${intervalIndex}_${index}`;
    const composite = index === pieces.length - 1 ? output : `osplitcomposite${intervalIndex}_${index}`;
    lines.push(`[${piece}]crop=w=${width}:h=${media.height}:x=${x}:y=0[${cropped}]`);
    lines.push(
      `[${base}][${cropped}]overlay=x=${x}:y=0:shortest=1:format=auto,`
      + `${index === pieces.length - 1 ? 'format=yuv420p,' : ''}`
      + `setsar=1[${composite}]`,
    );
    base = composite;
  });
}

function makeDynamicGridCells(count, media) {
  if (count === 0) return [];
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const width = Math.max(2, Math.floor(media.width / columns / 2) * 2);
  const height = Math.max(2, Math.floor(media.height / rows / 2) * 2);
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return { x: column * width, y: row * height, width, height };
  });
}

function composeContinuousGrid(
  lines,
  inputs,
  events,
  intervals,
  outputDurationSeconds,
  media,
  boundedInputs,
  fadedExtensions,
) {
  const videoOutputDurationSeconds = intervals.at(-1).end;
  lines.push(blackInterval('ogridbase', videoOutputDurationSeconds, media));
  let base = 'ogridbase';
  let compositeIndex = 0;

  events.forEach((event, eventIndex) => {
    const ranges = [];
    intervals.forEach((interval) => {
      const activeIndex = interval.active.indexOf(event);
      if (activeIndex < 0) return;
      const cell = makeDynamicGridCells(interval.active.length, media)[activeIndex];
      const previous = ranges.at(-1);
      if (
        previous
        && Math.abs(previous.end - interval.start) < 0.0000001
        && previous.x === cell.x
        && previous.y === cell.y
        && previous.width === cell.width
        && previous.height === cell.height
      ) {
        previous.end = interval.end;
      } else {
        ranges.push({ start: interval.start, end: interval.end, ...cell });
      }
    });
    if (ranges.length === 0) {
      lines.push(`${bracket(inputs[eventIndex])}nullsink`);
      return;
    }

    const voice = `ogridvoice${eventIndex}`;
    lines.push(makeContinuousGridVoice(
      inputs[eventIndex],
      voice,
      event,
      ranges,
      outputDurationSeconds,
      media,
      boundedInputs[eventIndex].startSeconds,
      fadedExtensions,
    ));
    const variantsBySize = new Map();
    ranges.forEach((range) => {
      const key = `${range.width}x${range.height}`;
      const variantRanges = variantsBySize.get(key) ?? [];
      variantRanges.push(range);
      variantsBySize.set(key, variantRanges);
    });
    const variants = [...variantsBySize.values()];
    const variantInputs = variants.map((_, variantIndex) => `ogridvariantin${eventIndex}_${variantIndex}`);
    if (variants.length === 1) {
      lines.push(`[${voice}]null[${variantInputs[0]}]`);
    } else {
      lines.push(
        `[${voice}]split=${variants.length}`
        + variantInputs.map((label) => `[${label}]`).join(''),
      );
    }
    variants.forEach((variantRanges, variantIndex) => {
      const { width, height } = variantRanges[0];
      const variant = `ogridvariant${eventIndex}_${variantIndex}`;
      lines.push(
        `[${variantInputs[variantIndex]}]`
        + `scale=w=${width}:h=${height}:force_original_aspect_ratio=increase:flags=lanczos,`
        + `crop=w=${width}:h=${height},`
        + `tpad=start_mode=add:start_duration=${decimal(ranges[0].start)}:color=black,`
        + `settb=AVTB,setpts=PTS-STARTPTS,setsar=1,format=yuv420p[${variant}]`,
      );
      const output = `ogridcomposite${compositeIndex}`;
      compositeIndex += 1;
      const x = timelineValueExpression(variantRanges, 'x');
      const y = timelineValueExpression(variantRanges, 'y');
      const enable = variantRanges.map((range) => (
        `gte(t,${decimal(range.start)})*lt(t,${decimal(range.end)})`
      )).join('+');
      lines.push(
        `[${base}][${variant}]overlay=x='${x}':y='${y}':eval=frame:`
        + 'eof_action=pass:repeatlast=0:shortest=0:format=yuv420:'
        + `enable='${enable}'[${output}]`,
      );
      base = output;
    });
  });

  lines.push(
    `[${base}]fps=${media.frameRate}:start_time=0:round=near,`
    + `tpad=stop_mode=clone:stop_duration=${decimal(frameDurationSeconds(media.frameRate))},`
    + `trim=duration=${decimal(videoOutputDurationSeconds)},`
    + 'settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[outv]',
  );
}

function makeContinuousGridVoice(
  input,
  output,
  event,
  ranges,
  outputDurationSeconds,
  media,
  inputStartSeconds,
  fadedExtensions,
) {
  const availableDuration = Math.min(
    event.videoDurationSeconds,
    outputDurationSeconds - event.videoStartSeconds,
  );
  const visualStart = ranges[0].start;
  const visualDuration = ranges.at(-1).end - visualStart;
  const sourceNeeded = availableDuration * event.speed;
  const sourceStart = event.reverse
    ? event.videoHighSeconds - sourceNeeded
    : event.videoLowSeconds;
  const sourceEnd = event.reverse
    ? event.videoHighSeconds
    : event.videoLowSeconds + sourceNeeded;
  const fadedRanges = [];
  const videoPreSeconds = event.triggerSeconds - event.videoStartSeconds;
  if (fadedExtensions && videoPreSeconds > 0) {
    fadedRanges.push(`lt(t,${decimal(videoPreSeconds)})`);
  }
  if (fadedExtensions && event.videoPostSeconds > 0) {
    fadedRanges.push(`gte(t,${decimal(videoPreSeconds + event.contentDurationSeconds)})`);
  }
  const filters = [
    `trim=start=${decimal(sourceStart - inputStartSeconds)}:`
      + `end=${decimal(sourceEnd - inputStartSeconds)}`,
    'setpts=PTS-STARTPTS',
    ...(event.reverse ? ['reverse'] : []),
    `setpts=PTS/${decimal(event.speed)}`,
    `fps=${media.frameRate}:start_time=0:round=near`,
    `tpad=stop_mode=clone:stop_duration=${decimal(frameDurationSeconds(media.frameRate))}`,
    `trim=duration=${decimal(visualDuration)}`,
    ...(fadedRanges.length > 0
      ? [fadedExtensionYuvOnBlackFilter(fadedRanges.join('+'))]
      : []),
    'settb=AVTB',
    'setpts=PTS-STARTPTS',
    'setsar=1',
    'format=yuv420p',
  ];
  return `${bracket(input)}${filters.join(',')}[${output}]`;
}

function timelineValueExpression(ranges, property) {
  let expression = decimal(ranges.at(-1)[property]);
  for (let index = ranges.length - 2; index >= 0; index -= 1) {
    expression = `if(lt(t,${decimal(ranges[index].end)}),${decimal(ranges[index][property])},${expression})`;
  }
  return expression;
}

function blackInterval(output, duration, media, format = 'yuv420p') {
  return `color=c=black:s=${media.width}x${media.height}:r=${media.frameRate}:d=${decimal(duration)},`
    + `settb=AVTB,setpts=PTS-STARTPTS,setsar=1,format=${format}[${output}]`;
}

function makeOverlapAudioVoice(
  input,
  output,
  event,
  outputDurationSeconds,
  audioSampleRate,
  inputStartSeconds,
) {
  const availableDuration = Math.min(
    event.contentDurationSeconds,
    outputDurationSeconds - event.triggerSeconds,
  );
  const sourceNeeded = availableDuration * event.speed;
  const sourceStart = event.reverse ? event.highSeconds - sourceNeeded : event.lowSeconds;
  const sourceEnd = event.reverse ? event.highSeconds : event.lowSeconds + sourceNeeded;
  const attack = Math.min(Math.max(0, event.attackMs / 1000), availableDuration);
  const reachesNaturalEnd = availableDuration >= event.contentDurationSeconds - 0.000001;
  const release = reachesNaturalEnd
    ? Math.min(Math.max(0, event.releaseMs / 1000), availableDuration)
    : 0;
  const delaySamples = Math.max(0, Math.round(event.triggerSeconds * audioSampleRate));
  const filters = [
    `atrim=start=${decimal(sourceStart - inputStartSeconds)}:`
      + `end=${decimal(sourceEnd - inputStartSeconds)}`,
    'asetpts=PTS-STARTPTS',
    ...(event.reverse ? ['areverse'] : []),
    `asetrate=${Math.max(1, Math.round(audioSampleRate * event.speed))}`,
    `aresample=${audioSampleRate}`,
    `aformat=sample_rates=${audioSampleRate}:channel_layouts=stereo`,
    `atrim=duration=${decimal(availableDuration)}`,
    `volume=${decimal(Math.max(0, event.volume))}`,
    ...(attack > 0 ? [`afade=t=in:st=0:d=${decimal(attack)}`] : []),
    ...(release > 0
      ? [`afade=t=out:st=${decimal(availableDuration - release)}:d=${decimal(release)}`]
      : []),
    `adelay=${delaySamples}S:all=1`,
    'asetpts=PTS-STARTPTS',
  ];
  return `${bracket(input)}${filters.join(',')}[${output}]`;
}

function fadedExtensionAlphaFilter() {
  return `colorchannelmixer=rr=${GRAYSCALE_RED}:rg=${GRAYSCALE_GREEN}:rb=${GRAYSCALE_BLUE}`
    + `:gr=${GRAYSCALE_RED}:gg=${GRAYSCALE_GREEN}:gb=${GRAYSCALE_BLUE}`
    + `:br=${GRAYSCALE_RED}:bg=${GRAYSCALE_GREEN}:bb=${GRAYSCALE_BLUE}:aa=0.5`;
}

function fadedExtensionOnBlackFilter(enable) {
  return `colorchannelmixer=rr=${GRAYSCALE_RED / 2}:rg=${GRAYSCALE_GREEN / 2}:rb=${GRAYSCALE_BLUE / 2}`
    + `:gr=${GRAYSCALE_RED / 2}:gg=${GRAYSCALE_GREEN / 2}:gb=${GRAYSCALE_BLUE / 2}`
    + `:br=${GRAYSCALE_RED / 2}:bg=${GRAYSCALE_GREEN / 2}:bb=${GRAYSCALE_BLUE / 2}`
    + `:enable='${enable}'`;
}

function fadedExtensionYuvOnBlackFilter(enable = null) {
  return "lutyuv=y='(val+16)/2':u=128:v=128"
    + (enable ? `:enable='${enable}'` : '');
}

function makeFilterGraph(segments, media, sources, fadedExtensions) {
  const leadingDurationSeconds = Math.max(0, segments[0].triggerTimeMs / 1000);
  const hasLeadingInterval = leadingDurationSeconds > 0;
  const count = segments.length + (hasLeadingInterval ? 1 : 0);
  const lines = [];
  const boundedInputs = makeBoundedInputs(
    segments,
    sources,
    (segment) => segment.sourceStartSeconds,
    (segment) => segment.sourceEndSeconds,
  );
  const videoInputs = allocateInputConsumers(boundedInputs.inputs, 'v', 'vin', lines);
  const audioInputs = allocateInputConsumers(boundedInputs.inputs, 'a', 'ain', lines);

  segments.forEach((segment, index) => {
    const inputStartSeconds = boundedInputs.inputs[index].startSeconds;
    const speed = Math.abs(segment.speed);
    const attack = Math.min(Math.max(0, segment.attackMs / 1000), segment.contentDurationSeconds);
    const release = Math.min(Math.max(0, segment.releaseMs / 1000), segment.contentDurationSeconds);
    const releaseStart = Math.max(0, segment.contentDurationSeconds - release);
    const fadedRanges = [];
    if (fadedExtensions && segment.preSeconds > 0) {
      fadedRanges.push(`lt(t,${decimal(segment.preSeconds)})`);
    }
    if (fadedExtensions && segment.postSeconds > 0) {
      fadedRanges.push(`gte(t,${decimal(segment.preSeconds + segment.contentDurationSeconds)})`);
    }
    const videoFilters = [
      `trim=start=${decimal(segment.sourceStartSeconds - inputStartSeconds)}:`
        + `end=${decimal(segment.sourceEndSeconds - inputStartSeconds)}`,
      'setpts=PTS-STARTPTS',
      ...(segment.reverse ? ['reverse'] : []),
      `setpts=PTS/${decimal(speed)}`,
      `tpad=stop_mode=clone:stop_duration=${decimal(segment.durationSeconds)}`,
      `trim=duration=${decimal(segment.durationSeconds)}`,
      `scale=w=${media.width}:h=${media.height}:flags=lanczos`,
      'settb=AVTB',
      'setpts=PTS-STARTPTS',
      'setsar=1',
      ...(fadedRanges.length > 0
        ? ['format=rgba', fadedExtensionOnBlackFilter(fadedRanges.join('+')), 'format=yuv420p']
        : ['format=yuv420p']),
    ];
    const audioFilters = [
      `atrim=start=${decimal(segment.audioSourceStartSeconds - inputStartSeconds)}:`
        + `end=${decimal(segment.audioSourceEndSeconds - inputStartSeconds)}`,
      'asetpts=PTS-STARTPTS',
      ...(segment.reverse ? ['areverse'] : []),
      `asetrate=${Math.max(1, Math.round(media.audioSampleRate * speed))}`,
      `aresample=${media.audioSampleRate}`,
      `aformat=sample_rates=${media.audioSampleRate}:channel_layouts=stereo`,
      `volume=${decimal(Math.max(0, segment.volume))}`,
      ...(attack > 0 ? [`afade=t=in:st=0:d=${decimal(attack)}`] : []),
      ...(release > 0 ? [`afade=t=out:st=${decimal(releaseStart)}:d=${decimal(release)}`] : []),
      ...(segment.preSeconds > 0
        ? [`adelay=${Math.round(segment.preSeconds * media.audioSampleRate)}S:all=1`]
        : []),
      `apad=pad_dur=${decimal(segment.durationSeconds)}`,
      `atrim=duration=${decimal(segment.durationSeconds)}`,
      'asetpts=PTS-STARTPTS',
    ];
    lines.push(`${bracket(videoInputs[index])}${videoFilters.join(',')}[v${index}]`);
    lines.push(`${bracket(audioInputs[index])}${audioFilters.join(',')}[a${index}]`);
  });

  if (hasLeadingInterval) {
    lines.push(blackInterval('vlead', leadingDurationSeconds, media));
    lines.push(
      `anullsrc=r=${media.audioSampleRate}:cl=stereo,`
      + `atrim=duration=${decimal(leadingDurationSeconds)},asetpts=PTS-STARTPTS[alead]`,
    );
  }
  const concatInputs = (hasLeadingInterval ? '[vlead][alead]' : '')
    + segments.map((_, index) => `[v${index}][a${index}]`).join('');
  lines.push(`${concatInputs}concat=n=${count}:v=1:a=1[rawv][outa]`);
  // Audio keeps the concatenated boundaries sample-accurate. Converting the
  // completed video timeline to a constant frame rate avoids adding up one
  // frame-rounding error for every chop.
  lines.push(`[rawv]fps=${media.frameRate},settb=AVTB,setpts=PTS-STARTPTS[outv]`);
  return {
    filter: `${lines.join(';\n')}\n`,
    inputArguments: boundedInputs.arguments,
  };
}

function makeBoundedInputs(items, sources, startSecondsFor, endSecondsFor) {
  const arguments_ = [];
  const requests = items.map((item) => {
    const source = sources[item.sourceIndex];
    if (!source) throw new Error(`Could not resolve source input ${item.sourceIndex}.`);
    const startSeconds = startSecondsFor(item);
    const endSeconds = endSecondsFor(item);
    if (endSeconds <= startSeconds) {
      throw new Error(`CSV row ${item.captureOrder + 2} selects an empty source input.`);
    }
    return { source, startSeconds, endSeconds, input: null };
  });
  const regions = [];
  sources.forEach((source) => {
    const sourceRequests = requests
      .filter((request) => request.source === source)
      .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
    let region = null;
    sourceRequests.forEach((request) => {
      if (!region || request.startSeconds > region.endSeconds + 0.000000001) {
        region = {
          source,
          startSeconds: request.startSeconds,
          endSeconds: request.endSeconds,
          requests: [],
        };
        regions.push(region);
      } else {
        region.endSeconds = Math.max(region.endSeconds, request.endSeconds);
      }
      region.requests.push(request);
    });
  });
  regions.forEach((region, inputIndex) => {
    arguments_.push(
      '-threads', '1',
      '-ss', decimal(region.startSeconds),
      '-t', decimal(region.endSeconds - region.startSeconds),
      '-i', region.source.path,
    );
    const input = {
      audio: `${inputIndex}:a`,
      video: `${inputIndex}:v`,
      startSeconds: region.startSeconds,
    };
    region.requests.forEach((request) => { request.input = input; });
  });
  const inputs = requests.map((request) => request.input);
  return { arguments: arguments_, inputs };
}

function allocateInputConsumers(inputs, stream, prefix, lines) {
  const outputLabels = inputs.map((_, index) => `${prefix}${index}`);
  const consumerIndexesByInput = new Map();
  inputs.forEach((input, consumerIndex) => {
    if (!input) throw new Error('Could not resolve a bounded filter input.');
    const consumerIndexes = consumerIndexesByInput.get(input) ?? [];
    consumerIndexes.push(consumerIndex);
    consumerIndexesByInput.set(input, consumerIndexes);
  });
  consumerIndexesByInput.forEach((consumerIndexes, input) => {
    const filter = stream === 'v' ? 'split' : 'asplit';
    const resetTimestamps = stream === 'v' ? 'setpts=PTS-STARTPTS' : 'asetpts=PTS-STARTPTS';
    lines.push(
      `${bracket(input[stream === 'v' ? 'video' : 'audio'])}`
      + `${resetTimestamps},${filter}=${consumerIndexes.length}`
      + consumerIndexes.map((index) => bracket(outputLabels[index])).join(''),
    );
  });
  return outputLabels;
}

function bracket(label) {
  return `[${label}]`;
}

function decimal(value) {
  if (!Number.isFinite(value)) throw new Error('Cannot build an ffmpeg filter from a non-finite number.');
  return Number(value.toFixed(9)).toString();
}

function run(command, arguments_, captureOutput = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (captureOutput) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.on('error', (error) => {
      if (error.code === 'ENOENT') reject(new Error(`${command} is not installed or not on PATH.`));
      else reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} exited with status ${code}${stderr ? `:\n${stderr.trim()}` : '.'}`));
    });
  });
}
