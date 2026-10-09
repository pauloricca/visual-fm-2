import { PatchPlayer } from '@pauloricca/teia-runtime';

const pick = (id) => document.getElementById(id);
const fileInput = pick('package');
const status = pick('status');
const play = pick('play');
const stop = pick('stop');
const note = pick('note');
const mic = pick('mic');
let context;
let player;
let microphone;
let microphoneStream;

function report(message) { status.textContent = message; }
function audioState() {
  return context ? `Audio ${context.state}.` : 'Audio engine unloaded.';
}
function renderParameters() {
  const target = pick('parameters');
  target.replaceChildren();
  if (player.parameters.length === 0) {
    const message = document.createElement('p');
    message.textContent = 'This patch has no Params outputs.';
    target.append(message);
    return;
  }
  for (const parameter of player.parameters) {
    const label = document.createElement('label');
    label.className = 'parameter';
    const name = document.createElement('span');
    name.textContent = parameter.name;
    const min = Number.isFinite(parameter.min) ? parameter.min : 0;
    const max = Number.isFinite(parameter.max) ? parameter.max : 1;
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    const current = player.getParameter(parameter.id);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(lower);
    slider.max = String(upper);
    slider.step = 'any';
    slider.value = String(current);
    slider.setAttribute('aria-label', parameter.name);
    const readout = document.createElement('output');
    readout.textContent = String(current);
    slider.addEventListener('input', () => {
      try {
        player.setParameter(parameter.id, Number(slider.value));
        readout.textContent = String(player.getParameter(parameter.id));
      } catch (error) { report(error.message); }
    });
    const control = document.createElement('div');
    control.className = 'parameter-control';
    control.append(slider, readout);
    const range = document.createElement('small');
    range.textContent = `${lower} to ${upper}`;
    const id = document.createElement('small');
    id.textContent = parameter.id;
    label.append(name, control, range, id);
    target.append(label);
  }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  report('Loading and verifying package…');
  play.disabled = stop.disabled = note.disabled = mic.disabled = true;
  try {
    if (microphone) microphone.disconnect();
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphone = microphoneStream = undefined;
    player?.dispose();
    if (context) await context.close();
    context = new AudioContext();
    context.addEventListener('statechange', () => {
      if (player) report(audioState());
    });
    await context.suspend();
    player = await PatchPlayer.load(context, file);
    player.connect(context.destination);
    const patch = player.manifest;
    pick('patch-name').textContent = file.name;
    pick('info').textContent = `DSP program ${patch.programVersion} · ${player.parameters.length} parameters · ${patch.assets.length} assets · ${player.sampleRate} Hz`;
    pick('details').hidden = false;
    renderParameters();
    play.disabled = stop.disabled = note.disabled = mic.disabled = false;
    report('Loaded. Press Start audio to play.');
  } catch (error) {
    report(`Load failed: ${error.message}`);
  }
});

play.addEventListener('click', async () => {
  try { await context.resume(); report(audioState()); }
  catch (error) { report(`Could not start audio: ${error.message}`); }
});
stop.addEventListener('click', async () => {
  try {
    player.reset();
    await context.suspend();
    report(audioState());
  }
  catch (error) { report(`Could not stop audio: ${error.message}`); }
});
note.addEventListener('pointerdown', () => { player.noteOn(60, 0.8); });
for (const event of ['pointerup', 'pointercancel', 'pointerleave']) {
  note.addEventListener(event, () => { if (player) player.noteOff(60); });
}
mic.addEventListener('click', async () => {
  try {
    if (microphone) {
      microphone.disconnect();
      microphoneStream.getTracks().forEach((track) => track.stop());
      microphone = microphoneStream = undefined;
      mic.textContent = 'Connect microphone';
      report('Microphone disconnected.');
      return;
    }
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphone = context.createMediaStreamSource(microphoneStream);
    microphone.connect(player.node);
    mic.textContent = 'Disconnect microphone';
    report('Microphone connected to patch input.');
  } catch (error) { report(`Microphone failed: ${error.message}`); }
});
