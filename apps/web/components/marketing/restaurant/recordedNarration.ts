/** One persistent audio element keeps the user gesture's media permission across steps. */
export class RecordedNarration {
  private activeKey: string | undefined;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private audio: HTMLAudioElement) {}

  play(key: string, url: string, rate: number, ended: () => void, failed: (reason: string) => void, startAt = 0) {
    if (this.activeKey === key) return;
    this.stop();
    this.activeKey = key;
    const generation = this.generation, started = Date.now();
    const current = () => generation === this.generation && this.activeKey === key;
    const fail = (reason: string) => { if (current()) { this.stop(); failed(reason); } };
    const watch = () => {
      if (!current()) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => fail("timeout"), 15000);
    };
    this.audio.onended = () => {
      if (!current()) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { if (current()) { this.stop(); ended(); } }, Math.max(0, 1500 - (Date.now() - started)));
    };
    this.audio.onerror = () => fail("file");
    this.audio.onplaying = watch;
    this.audio.ontimeupdate = watch;
    this.audio.onloadedmetadata = () => {
      if (current() && Number.isFinite(startAt) && startAt > 0 && Number.isFinite(this.audio.duration)) {
        this.audio.currentTime = Math.min(startAt, Math.max(0, this.audio.duration - 0.05));
      }
    };
    this.audio.src = url;
    this.audio.playbackRate = rate;
    watch();
    // Called synchronously by Play on the first step (important for mobile autoplay rules).
    try { void this.audio.play().catch(error => fail(error?.name === "NotAllowedError" ? "not-allowed" : "file")); }
    catch { fail("file"); }
  }

  stop() {
    this.generation++;
    this.activeKey = undefined;
    clearTimeout(this.timer);
    this.audio.onended = this.audio.onerror = this.audio.onplaying = this.audio.ontimeupdate = this.audio.onloadedmetadata = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}
