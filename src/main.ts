import { App } from './app/App';

const intro = document.getElementById('intro')!;
const headsetButton = document.getElementById('enter-headset') as HTMLButtonElement;
const desktopButton = document.getElementById('enter-desktop') as HTMLButtonElement;
const note = document.getElementById('xr-note')!;
const headsetHelp = document.getElementById('headset-help') as HTMLDetailsElement;

// Touchscreens can read the setup page, but the desktop experience needs a
// mouse and keyboard. Check when clicked so attaching a mouse still works.
const touchOnly = () => window.matchMedia('(any-pointer: coarse)').matches &&
  !window.matchMedia('(any-pointer: fine)').matches;
const desktopInputNote = 'Desktop preview needs a computer with a mouse and keyboard. For the headset experience, open this site in Quest Browser on your Quest 3S.';

async function installEmulatorIfRequested() {
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('emulate')) return;
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  device.primaryInputMode = 'hand';
  (window as unknown as { xrDevice: unknown }).xrDevice = device;
  try {
    const { DevUI } = await import('@iwer/devui');
    device.installDevUI(DevUI);
  } catch (err) {
    console.warn('IWER DevUI unavailable', err);
  }
}

async function supportsPassthrough() {
  if (!navigator.xr || !window.isSecureContext) return false;
  let timer = 0;
  try {
    return await Promise.race([
      navigator.xr.isSessionSupported('immersive-ar'),
      new Promise<boolean>((resolve) => { timer = window.setTimeout(() => resolve(false), 8000); })
    ]);
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

async function boot() {
  await installEmulatorIfRequested();
  // The opening and headset setup remain usable even on a browser that cannot
  // render WebGL. Create the 3D scene only after the visitor chooses a mode.
  let app: App | undefined;
  const hideIntro = () => {
    intro.classList.add('hidden');
    intro.inert = true;
    intro.setAttribute('aria-hidden', 'true');
  };
  const showIntro = () => {
    intro.classList.remove('hidden');
    intro.inert = false;
    intro.removeAttribute('aria-hidden');
  };
  let starting = false;
  let arSupported = false;
  let checking = true;
  let graphicsUnavailable = false;
  let interactionStarted = false;

  const refreshButtons = () => {
    desktopButton.disabled = starting || graphicsUnavailable;
    headsetButton.disabled = starting || checking || (graphicsUnavailable && arSupported);
    headsetButton.textContent = starting ? 'Entering your room…' : checking ? 'Checking headset…' : 'Enter headset';
  };

  const getApp = () => {
    if (!app) {
      app = new App(document.getElementById('app')!);
      (window as unknown as { app: App }).app = app;
      app.renderer.xr.addEventListener('sessionend', () => {
        showIntro();
        note.textContent = 'Headset session ended. Choose how you would like to continue.';
        refreshButtons();
      });
    }
    return app;
  };

  const explainGraphicsFailure = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!/WebGL|graphics context/i.test(message)) return false;
    graphicsUnavailable = true;
    note.textContent = 'This browser cannot start 3D graphics. Open this site in Chrome or Edge with graphics acceleration enabled, or in Quest Browser on your Quest 3S.';
    refreshButtons();
    return true;
  };

  desktopButton.addEventListener('click', () => {
    if (starting || app?.renderer.xr.isPresenting) return;
    interactionStarted = true;
    if (touchOnly()) {
      note.textContent = desktopInputNote;
      headsetHelp.open = true;
      headsetHelp.scrollIntoView({ block: 'nearest' });
      return;
    }
    try {
      const experience = getApp();
      // Input and visuals can begin even when an audio device refuses to resume.
      void experience.startAudio();
      experience.enterDesktop();
      hideIntro();
    } catch (err) {
      console.error(err);
      if (!explainGraphicsFailure(err)) note.textContent = 'The experience could not start. Please reload this page and try again.';
    }
  });

  const startHeadset = async () => {
    if (starting || app?.renderer.xr.isPresenting) return;
    interactionStarted = true;
    if (!arSupported) {
      headsetHelp.open = true;
      note.textContent = window.isSecureContext
        ? 'Open this site in Quest Browser on your Quest 3S, then choose Enter headset. Observers can watch on a computer using Meta casting.'
        : 'Your headset needs the HTTPS version of this site. Desktop preview needs a mouse and keyboard; see the headset setup below.';
      headsetHelp.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    starting = true;
    refreshButtons();
    note.textContent = '';
    try {
      // Preserve transient user activation: request the session BEFORE awaiting audio.
      // The public headset journey ALWAYS starts with the wearer's real room.
      const experience = getApp();
      const session = experience.enterXR();
      void experience.startAudio();
      await session;
      hideIntro();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!explainGraphicsFailure(err)) note.textContent = `Could not enter your room: ${message} Use Quest Browser with hand tracking enabled, or choose Desktop preview.`;
      headsetHelp.open = true;
    } finally {
      starting = false;
      refreshButtons();
    }
  };
  headsetButton.addEventListener('click', () => void startHeadset());
  arSupported = await supportsPassthrough();
  checking = false;
  refreshButtons();
  if (!interactionStarted) note.textContent = !window.isSecureContext
    ? 'A headset needs HTTPS. Desktop preview needs a mouse and keyboard.'
    : arSupported
      ? 'Begin in your real surroundings. Cross the tear into entirely virtual worlds.'
      : touchOnly()
        ? desktopInputNote
        : 'Explore here on desktop, or open this site in Quest Browser on your Quest 3S.';
}

boot().catch((err) => {
  console.error(err);
  note.textContent = 'Something failed to load: ' + (err instanceof Error ? err.message : String(err));
});
