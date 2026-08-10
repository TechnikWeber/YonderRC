import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Local recording of the live FPV stream: start/stop video capture (WebM) and
 * one-tap snapshots (PNG). You pick a target folder ONCE before flight (via the
 * File System Access API) so nothing needs clicking mid-flight; without that API
 * (e.g. Firefox) files just go to the browser's download folder. Actions are also
 * exposed so they can be bound to a keyboard key or controller button.
 */

export interface RecorderSettings {
  prefix: string;
  recordKey: string; // keyboard key for record toggle
  snapshotKey: string; // keyboard key for snapshot
  recordButton: number | null; // gamepad button index
  snapshotButton: number | null;
}

const KEY = 'yonderrc.recorder.v1';
const DEFAULTS: RecorderSettings = {
  prefix: 'yonderrc',
  recordKey: 'r',
  snapshotKey: 't',
  recordButton: null,
  snapshotButton: null,
};

function load(): RecorderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RecorderSettings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// FS Access API isn't in the default TS lib everywhere; keep it loosely typed.
type DirHandle = { name: string; getFileHandle: (n: string, o: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> };

export function useRecorder(videoRef: React.RefObject<HTMLVideoElement>) {
  const [settings, setSettingsState] = useState<RecorderSettings>(load);
  const [recording, setRecording] = useState(false);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const dirRef = useRef<DirHandle | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const setSettings = useCallback((patch: Partial<RecorderSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const flash = (msg: string) => {
    setLastAction(msg);
    setTimeout(() => setLastAction((m) => (m === msg ? null : m)), 2500);
  };

  const saveBlob = useCallback(async (blob: Blob, filename: string) => {
    const dir = dirRef.current;
    if (dir) {
      try {
        const fh = await dir.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        flash(`Saved ${filename} → ${dir.name}/`);
        return;
      } catch {
        /* fall back to download */
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash(`Saved ${filename} (downloads)`);
  }, []);

  const pickFolder = useCallback(async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirHandle> }).showDirectoryPicker;
    if (!picker) {
      flash('Folder picker unsupported — files go to Downloads');
      return;
    }
    try {
      const dir = await picker();
      dirRef.current = dir;
      setFolderName(dir.name);
    } catch {
      /* user cancelled */
    }
  }, []);

  const snapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      flash('No video to snapshot');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) void saveBlob(blob, `${settings.prefix}-${stamp()}.png`);
    }, 'image/png');
  }, [videoRef, settings.prefix, saveBlob]);

  const stopRecord = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const startRecord = useCallback(() => {
    const video = videoRef.current;
    const stream = (video?.srcObject as MediaStream | null) ?? null;
    if (!stream) {
      flash('No video stream to record');
      return;
    }
    const types = ['video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      void saveBlob(blob, `${settings.prefix}-${stamp()}.webm`);
      setRecording(false);
    };
    rec.start(1000);
    recRef.current = rec;
    setRecording(true);
    flash('Recording…');
  }, [videoRef, settings.prefix, saveBlob]);

  const toggleRecord = useCallback(() => {
    if (recRef.current && recRef.current.state !== 'inactive') stopRecord();
    else startRecord();
  }, [startRecord, stopRecord]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    };
  }, []);

  return {
    settings,
    setSettings,
    recording,
    folderName,
    lastAction,
    pickFolder,
    snapshot,
    toggleRecord,
  };
}
