/// <reference path="../shared/types.ts" />

const indicator = document.getElementById("indicator")!;
const icon = document.getElementById("icon")!;
const stateLabel = document.getElementById("stateLabel")!;
const statusMessage = document.getElementById("statusMessage")!;

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

const stateConfig: Record<
  string,
  { icon: string; label: string; defaultMessage: string }
> = {
  idle: { icon: "\u23F8", label: "IDLE", defaultMessage: "Hold Fn to speak" },
  recording: {
    icon: "\u{1F534}",
    label: "RECORDING",
    defaultMessage: "Listening...",
  },
  transcribing: {
    icon: "\u{1F504}",
    label: "TRANSCRIBING",
    defaultMessage: "Converting speech to text...",
  },
  thinking: {
    icon: "\u{1F9E0}",
    label: "THINKING",
    defaultMessage: "pi is thinking...",
  },
  speaking: {
    icon: "\u{1F50A}",
    label: "SPEAKING",
    defaultMessage: "Playing response...",
  },
  error: { icon: "\u26A0", label: "ERROR", defaultMessage: "An error occurred" },
};

// State updates from main
window.piVoice.onStateChanged((state) => {
  // Remove all state classes
  document.body.className = "";
  document.body.classList.add(`state-${state}`);

  const config = stateConfig[state];
  if (config) {
    icon.textContent = config.icon;
    stateLabel.textContent = config.label;
    statusMessage.textContent = config.defaultMessage;
  }
});

window.piVoice.onStatusMessage((message) => {
  statusMessage.textContent = message;
});

// Recording control from main
window.piVoice.onStartRecording(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      // Stop all tracks
      stream.getTracks().forEach((track) => track.stop());

      if (audioChunks.length === 0) {
        window.piVoice.sendRecordingError("No audio data captured");
        return;
      }

      const blob = new Blob(audioChunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      window.piVoice.sendRecordingData(arrayBuffer);
    };

    mediaRecorder.start(100); // Collect data every 100ms
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    window.piVoice.sendRecordingError(`Microphone access failed: ${msg}`);
  }
});

window.piVoice.onStopRecording(() => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
});

// Audio playback from main
window.piVoice.onPlayAudio(async (audioData) => {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    // Stop any currently playing audio
    if (currentSource) {
      try {
        currentSource.stop();
      } catch {
        // ignore
      }
    }

    const audioBuffer = await audioContext.decodeAudioData(
      audioData instanceof ArrayBuffer ? audioData : new Uint8Array(audioData as any).buffer
    );
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    source.onended = () => {
      currentSource = null;
      window.piVoice.sendPlaybackDone();
    };

    currentSource = source;
    source.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Playback error:", msg);
    window.piVoice.sendPlaybackDone();
  }
});
