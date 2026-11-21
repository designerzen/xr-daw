import {
  detectImportFile,
  importMusicalFile,
  FILE_IMPORT_FORMATS,
} from "audiobus/importers/file-import.ts";
import type { IAudioCommand } from "audiobus/commands/audio-command-interface.ts";
import AudioCommand from "audiobus/commands/audio-command.ts";
import AudioEvent from "audiobus/models/audio-event.ts";
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands.ts";
import { importMidi, exportMidi } from "./midi";
import {
  validateProject,
  tickToSeconds,
  projectEnd,
  type Project,
  type Note,
} from "./project";

export const MEDIA_ACCEPT = [
  "audio/*",
  ".wave",
  ".xrdaw.json",
  ".zip",
  ...FILE_IMPORT_FORMATS.filter((format) => format.kind !== "bundle").flatMap(
    (format) => format.extensions.map((ext) => `.${ext}`),
  ),
].join(",");

/** Importer commands use seconds; a fixed axis retains their performed timing. */
export function commandsToProject(
  commands: IAudioCommand[],
  name: string,
): Project {
  const project: Project = {
    version: 1,
    name,
    ppq: 480,
    tempos: [{ tick: 0, bpm: 120 }],
    tracks: [],
    notes: [],
  };
  const pending = new Map<string, { command: IAudioCommand; note: Note }[]>();
  const tracks = new Map<string, string>();
  for (const command of [...commands].sort((a, b) => a.startAt - b.startAt)) {
    if (command.type !== NOTE_ON && command.type !== NOTE_OFF) continue;
    if (!Number.isFinite(command.startAt) || command.startAt < 0)
      throw new Error("Invalid imported note time.");
    const source = JSON.stringify([
      command.chainId,
      command.inputId,
      command.from,
      command.channel,
    ]);
    const key = `${source}:${command.number}`;
    if (command.type === NOTE_OFF || command.velocity === 0) {
      const held = pending.get(key)?.shift();
      if (held && !(held.command.endAt > held.command.startAt)) {
        held.note.duration = Math.max(
          1,
          command.startAt * 960 - held.note.start,
        );
      }
      continue;
    }
    let trackId = tracks.get(source);
    if (!trackId) {
      trackId = `import-track-${tracks.size}`;
      tracks.set(source, trackId);
      project.tracks.push({
        id: trackId,
        name: `Part ${command.channel || tracks.size}`,
        gain: 0.7,
        muted: false,
      });
    }
    const note: Note = {
      id: `import-note-${project.notes.length}`,
      trackId,
      pitch: command.number,
      velocity: command.velocity / 127,
      start: command.startAt * 960,
      duration:
        command.endAt > command.startAt
          ? (command.endAt - command.startAt) * 960
          : 120,
    };
    project.notes.push(note);
    const queue = pending.get(key) ?? [];
    queue.push({ command, note });
    pending.set(key, queue);
  }
  if (!project.notes.length)
    throw new Error("This file contains no importable notes.");
  return validateProject(project);
}

export async function importMediaFile(
  file: File,
): Promise<{ kind: "audio" } | { kind: "project"; project: Project }> {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("Files must be smaller than 100 MB.");
  if (/\.json$/i.test(file.name) && file.size <= 64 * 1024 * 1024) {
    const data = JSON.parse(await file.text());
    if (
      /\.xrdaw\.json$/i.test(file.name) ||
      data?.ppq !== undefined ||
      (data?.version !== undefined && !data?.time)
    ) {
      return { kind: "project", project: validateProject(data) };
    }
  }
  // Keep the existing 100 MB audio limit; audiobus limits musical containers to 64 MB.
  if (
    file.size > 64 * 1024 * 1024 &&
    (file.type.startsWith("audio/") ||
      /\.(wav|wave|mp3|ogg|flac|m4a|aiff?|aac|webm|opus)$/i.test(file.name))
  )
    return { kind: "audio" };
  const detected = await detectImportFile(file);
  if (detected.format.kind === "audio") return { kind: "audio" };
  if (detected.format.kind === "bundle") {
    const midi = Object.entries(detected.archive ?? {}).filter(
      ([, bytes]) => new TextDecoder().decode(bytes.subarray(0, 4)) === "MThd",
    );
    if (midi.length !== 1)
      throw new Error(
        "Drop an individual music file, or a ZIP containing exactly one MIDI file. Instrument bundles are not supported.",
      );
    return {
      kind: "project",
      project: importMidi(midi[0][1], file.name.replace(/\.[^.]+$/, "")),
    };
  }
  const name = file.name.replace(/(?:\.tone)?\.[^.]+$/i, "");
  if (detected.format.id === "midi")
    return {
      kind: "project",
      project: importMidi(new Uint8Array(await file.arrayBuffer()), name),
    };
  const result = await importMusicalFile(file, detected.format.id);
  return { kind: "project", project: commandsToProject(result.commands, name) };
}

export const NOTE_EXPORT_FORMATS = [
  ["midi", "MIDI", "mid"],
  ["musicxml", "MusicXML", "musicxml"],
  ["mxl", "Compressed MusicXML", "mxl"],
  ["dawproject", "DAWproject", "dawproject"],
  ["abc", "ABC notation", "abc"],
  ["midi-csv", "MIDI CSV", "csv"],
  ["mml", "MML", "mml"],
  ["rtttl", "RTTTL ringtone", "rtttl"],
  ["lilypond", "LilyPond", "ly"],
  ["notesequence", "NoteSequence", "noteseq"],
  ["tone-json", "Tone.js JSON", "tone.json"],
  ["jams", "JAMS", "jams"],
  ["ust", "UTAU", "ust"],
  ["svl", "Sonic Visualiser", "svl"],
  ["rmid", "RIFF MIDI", "rmi"],
  ["guitar-pro", "Guitar Pro", "gp"],
  ["alphatex", "alphaTex", "atex"],
  ["svp", "Synthesizer V", "svp"],
  ["ustx", "OpenUtau", "ustx"],
  ["ufdata", "UtaFormatix", "ufdata"],
  ["lmms", "LMMS", "mmp"],
  ["lmms-compressed", "Compressed LMMS", "mmpz"],
] as const;
export type NoteExportId = (typeof NOTE_EXPORT_FORMATS)[number][0];

export function projectRecording(project: Project) {
  const tracks = project.tracks.filter((track) =>
    project.notes.some((note) => note.trackId === track.id),
  );
  if (tracks.length > 15)
    throw new Error(
      "This format supports up to 15 melodic tracks. Use MIDI or Save project for this arrangement.",
    );
  const channels = tracks.map((_, i) => (i < 9 ? i + 1 : i + 2));
  const events = project.notes.flatMap((note) => {
    const channel =
      channels[tracks.findIndex((track) => track.id === note.trackId)];
    const startAt = tickToSeconds(project, note.start),
      endAt = tickToSeconds(project, note.start + note.duration);
    const common = {
      number: note.pitch,
      channel,
      velocity: Math.round(note.velocity * 127),
      from: note.trackId,
      inputId: note.id,
    };
    return [
      Object.assign(new AudioEvent(new AudioCommand(), startAt), common, {
        type: NOTE_ON,
        startAt,
        endAt,
        time: startAt,
      }),
      Object.assign(new AudioEvent(new AudioCommand(), endAt), common, {
        type: NOTE_OFF,
        startAt: endAt,
        time: endAt,
        velocity: 0,
      }),
    ];
  });
  return {
    name: project.name,
    duration: tickToSeconds(project, projectEnd(project)),
    events,
  };
}

export async function exportNotes(
  project: Project,
  format: NoteExportId,
): Promise<Blob> {
  if (!project.notes.length)
    throw new Error("Add some notes before exporting.");
  if (format === "midi") return exportMidi(project);
  const recording = projectRecording(project),
    timer = { BPM: project.tempos[0].bpm };
  switch (format) {
    case "musicxml":
      return (
        await import("audiobus/exporters/adapter-musicxml.ts")
      ).createMusicXMLFromAudioEventRecording(recording, timer);
    case "mxl":
      return (
        await import("audiobus/exporters/adapter-musicxml.ts")
      ).createMXLFromAudioEventRecording(recording, timer);
    case "dawproject":
      return (
        await import("audiobus/exporters/adapter-dawproject.ts")
      ).createDawProjectFromAudioEventRecording(recording, timer);
    case "abc":
      return new Blob(
        [
          (
            await import("audiobus/exporters/adapter-abc.ts")
          ).createABCFromAudioEventRecording(recording, timer),
        ],
        { type: "text/plain" },
      );
    case "midi-csv":
      return new Blob(
        [
          (
            await import("audiobus/exporters/adapter-midi-csv.ts")
          ).createMIDICSVFromAudioEventRecording(recording, timer),
        ],
        { type: "text/csv" },
      );
    case "mml":
      return new Blob(
        [
          (
            await import("audiobus/exporters/adapter-mml.ts")
          ).createMMLFromAudioEventRecording(recording, timer),
        ],
        { type: "text/plain" },
      );
    case "rtttl":
      return new Blob(
        [
          (
            await import("audiobus/exporters/adapter-rtttl.ts")
          ).createRTTTLFromAudioEventRecording(recording, timer),
        ],
        { type: "text/plain" },
      );
    case "lilypond":
      return new Blob(
        [
          (
            await import("audiobus/exporters/adapter-lilypond.ts")
          ).createLilyPondFromAudioEventRecording(recording, timer),
        ],
        { type: "text/plain" },
      );
    case "notesequence":
      return new Blob(
        [
          (
            await import("audiobus/exporters/adapter-note-sequence.ts")
          ).createNoteSequenceFromAudioEventRecording(recording, timer),
        ],
        { type: "application/json" },
      );
    default:
      return (
        await import("audiobus/exporters/adapter-interchange.ts")
      ).exportInterchangeRecording(recording, timer, format);
  }
}
