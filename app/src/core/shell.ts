/** Window-level actions that differ between the desktop app and a browser tab. */
import { PACKAGE } from './root';

/** In the desktop app (never the package's reader, whose build then leaves the desktop's code out). */
export const isTauri = !PACKAGE && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** A browser tab saves a file by following a link to it. */
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const shell = {
  /** Opens an address a book links to, outside the reader: a new tab, or the system's
   *  browser. Web and mail addresses only (as the importer keeps); false for others. */
  async openLink(url: string): Promise<boolean> {
    let u: URL;
    try { u = new URL(url); } catch { return false; }
    if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) return false;
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_url', { url: u.href });
    } else {
      window.open(u.href, '_blank', 'noopener,noreferrer');
    }
    return true;
  },
  async toggleFullscreen() {
    if (isTauri) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      await w.setFullscreen(!(await w.isFullscreen()));
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await document.documentElement.requestFullscreen?.().catch(() => {});
  },
  /** Offers text as a file to save. Returns false if the reader cancelled. */
  async saveText(name: string, text: string, ext: 'md' | 'json' | 'vnotes' = 'md'): Promise<boolean> {
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<boolean>('save_text', { name, text, ext });
    }
    download(new Blob([text], { type: ext === 'md' ? 'text/markdown' : 'application/json' }), name);
    return true;
  },
  /** Offers bytes as a file to save (a sealed book). Returns false if cancelled. */
  async saveBytes(name: string, bytes: Uint8Array): Promise<boolean> {
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<boolean>('save_bytes', bytes, { headers: { 'x-name': encodeURIComponent(name) } });
    }
    download(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), name);
    return true;
  },
  /** Saves and releases resources before the app exits (set by the app). */
  beforeQuit: async () => {},
  async quit() {
    if (!isTauri) return;
    await shell.beforeQuit();
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('quit_now');
  },
  /** Routes the window's close button through `quit`. */
  async watchClose() {
    if (!isTauri) return;
    const { listen } = await import('@tauri-apps/api/event');
    await listen('typeset://closing', () => shell.quit());
  },
};
