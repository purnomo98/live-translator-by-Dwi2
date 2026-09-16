"use client";

import { useRef, useState } from "react";

type Direction = "ID_TO_ZH" | "ZH_TO_ID";

type Status =
  | "DISCONNECTED"
  | "CONNECTING"
  | "LISTENING"
  | "SPEAKING"
  | "ERROR";

function downsampleBuffer(
  buffer: Float32Array<ArrayBufferLike>,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array<ArrayBufferLike> {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  let resultOffset = 0;
  let bufferOffset = 0;

  while (resultOffset < result.length) {
    const nextBufferOffset = Math.min(
      Math.round((resultOffset + 1) * ratio),
      buffer.length
    );

    let accumulator = 0;
    let count = 0;

    for (
      let i = bufferOffset;
      i < nextBufferOffset;
      i++
    ) {
      accumulator += buffer[i];
      count++;
    }

    result[resultOffset] =
      count > 0 ? accumulator / count : 0;

    resultOffset++;
    bufferOffset = nextBufferOffset;
  }

  return result;
}

function floatTo16BitPCM(
  input: Float32Array<ArrayBufferLike>
): Int16Array<ArrayBufferLike> {
  const output = new Int16Array(input.length);

  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));

    output[i] =
      sample < 0
        ? sample * 0x8000
        : sample * 0x7fff;
  }

  return output;
}

function int16ToFloat32(
  input: Int16Array<ArrayBufferLike>
): Float32Array<ArrayBuffer> {
  const output = new Float32Array(
    new ArrayBuffer(input.length * 4)
  );

  for (let i = 0; i < input.length; i++) {
    output[i] =
      input[i] < 0
        ? input[i] / 0x8000
        : input[i] / 0x7fff;
  }

  return output;
}

function arrayBufferToBase64(
  buffer: ArrayBufferLike
): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + chunkSize, bytes.length)
    );

    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToInt16(
  base64: string
): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const usableByteLength =
    bytes.byteLength - (bytes.byteLength % 2);

  return new Int16Array(
    bytes.buffer,
    0,
    usableByteLength / 2
  );
}

export default function Home() {
  const [status, setStatus] =
    useState<Status>("DISCONNECTED");

  const [message, setMessage] =
    useState("Belum terhubung.");

  const [direction, setDirection] =
    useState<Direction>("ID_TO_ZH");

  const [inputText, setInputText] =
    useState("");

  const [outputText, setOutputText] =
    useState("");

  const wsRef =
    useRef<WebSocket | null>(null);

  const micStreamRef =
    useRef<MediaStream | null>(null);

  const inputAudioContextRef =
    useRef<AudioContext | null>(null);

  const playbackAudioContextRef =
    useRef<AudioContext | null>(null);

  const sourceRef =
    useRef<MediaStreamAudioSourceNode | null>(null);

  const processorRef =
    useRef<ScriptProcessorNode | null>(null);

  const nextPlaybackTimeRef =
    useRef(0);

  const mountedRef =
    useRef(true);

  function targetLanguageCode() {
    return direction === "ID_TO_ZH"
      ? "zh-Hans"
      : "id";
  }

  function directionLabel() {
    return direction === "ID_TO_ZH"
      ? "🇮🇩 Indonesia → 🇨🇳 Mandarin"
      : "🇨🇳 Mandarin → 🇮🇩 Indonesia";
  }

  async function playPCM24k(
    base64Audio: string
  ) {
    try {
      if (!playbackAudioContextRef.current) {
        playbackAudioContextRef.current =
          new AudioContext();
      }

      const audioContext =
        playbackAudioContextRef.current;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const pcm =
        base64ToInt16(base64Audio);

      if (pcm.length === 0) {
        return;
      }

      const samples =
        int16ToFloat32(pcm);

      const audioBuffer =
        audioContext.createBuffer(
          1,
          samples.length,
          24000
        );

      audioBuffer.copyToChannel(
        samples,
        0
      );

      const source =
        audioContext.createBufferSource();

      source.buffer = audioBuffer;

      source.connect(
        audioContext.destination
      );

      const now =
        audioContext.currentTime;

      if (
        nextPlaybackTimeRef.current <
        now
      ) {
        nextPlaybackTimeRef.current = now;
      }

      source.start(
        nextPlaybackTimeRef.current
      );

      nextPlaybackTimeRef.current +=
        audioBuffer.duration;

      if (mountedRef.current) {
        setStatus("SPEAKING");
        setMessage("Gemini sedang berbicara...");
      }

      source.onended = () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        if (
          audioContext.currentTime >=
          nextPlaybackTimeRef.current - 0.05
        ) {
          setStatus("LISTENING");
          setMessage("Mendengarkan...");
        }
      };
    } catch (error) {
      console.error(
        "AUDIO_PLAYBACK_ERROR",
        error
      );
    }
  }

  async function startMicrophone() {
    try {
      if (!wsRef.current) {
        throw new Error(
          "WebSocket belum tersedia."
        );
      }

      if (
        wsRef.current.readyState !==
        WebSocket.OPEN
      ) {
        throw new Error(
          "WebSocket belum terbuka."
        );
      }

      setMessage(
        "Meminta izin microphone..."
      );

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

      micStreamRef.current = stream;

      const audioContext =
        new AudioContext();

      inputAudioContextRef.current =
        audioContext;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source =
        audioContext.createMediaStreamSource(
          stream
        );

      sourceRef.current = source;

      const processor =
        audioContext.createScriptProcessor(
          4096,
          1,
          1
        );

      processorRef.current = processor;

      processor.onaudioprocess = (
        event
      ) => {
        const ws = wsRef.current;

        if (
          !ws ||
          ws.readyState !==
            WebSocket.OPEN
        ) {
          return;
        }

        const inputData =
          event.inputBuffer.getChannelData(0);

        const downsampled =
          downsampleBuffer(
            inputData,
            audioContext.sampleRate,
            16000
          );

        const pcm =
          floatTo16BitPCM(
            downsampled
          );

        const audioBase64 =
          arrayBufferToBase64(
            pcm.buffer
          );

        const message = {
          realtimeInput: {
            audio: {
              data: audioBase64,
              mimeType:
                "audio/pcm;rate=16000",
            },
          },
        };

        ws.send(
          JSON.stringify(message)
        );
      };

      source.connect(processor);

      processor.connect(
        audioContext.destination
      );

      setStatus("LISTENING");
      setMessage("Mendengarkan...");

      console.log(
        "MIC_STARTED",
        {
          sampleRate:
            audioContext.sampleRate,
        }
      );
    } catch (error) {
      console.error(
        "MIC_ERROR",
        error
      );

      if (
        mountedRef.current
      ) {
        setStatus("ERROR");
      }

      if (
        error instanceof DOMException
      ) {
        if (
          error.name ===
          "NotAllowedError"
        ) {
          setMessage(
            "Izin microphone ditolak."
          );
        } else if (
          error.name ===
          "NotFoundError"
        ) {
          setMessage(
            "Microphone tidak ditemukan."
          );
        } else {
          setMessage(
            `Microphone error: ${error.message}`
          );
        }
      } else {
        setMessage(
          error instanceof Error
            ? error.message
            : "Gagal mengakses microphone."
        );
      }
    }
  }

  async function connect() {
    try {
      if (
        status === "CONNECTING" ||
        status === "LISTENING" ||
        status === "SPEAKING"
      ) {
        return;
      }

      setInputText("");
      setOutputText("");

      setStatus("CONNECTING");
      setMessage(
        "Meminta ephemeral token..."
      );

      const response =
        await fetch(
          `/api/token?direction=${direction}`,
          {
            cache: "no-store",
          }
        );

      const tokenData =
        await response.json();

      if (!response.ok) {
        throw new Error(
          tokenData.error ||
            "Gagal mengambil token."
        );
      }

      if (!tokenData.token) {
        throw new Error(
          "Token tidak tersedia."
        );
      }

      setMessage(
        "Token berhasil. Membuka koneksi..."
      );

      const wsUrl =
        "wss://generativelanguage.googleapis.com/ws/" +
        "google.ai.generativelanguage.v1beta.GenerativeService." +
        "BidiGenerateContentConstrained?access_token=" +
        encodeURIComponent(
          tokenData.token
        );

      const ws =
        new WebSocket(wsUrl);

      wsRef.current = ws;

      ws.onopen = () => {
        console.log(
          "WEBSOCKET_OPEN"
        );

        const setupMessage = {
          setup: {
            model:
              "models/gemini-3.5-live-translate-preview",

            generationConfig: {
              responseModalities: [
                "AUDIO",
              ],

              translationConfig: {
                targetLanguageCode:
                  targetLanguageCode(),

                echoTargetLanguage:
                  false,
              },
            },

            inputAudioTranscription: {},

            outputAudioTranscription: {},
          },
        };

        ws.send(
          JSON.stringify(
            setupMessage
          )
        );

        setMessage(
          "Gemini menerima koneksi. Menunggu setup..."
        );

        console.log(
          "SETUP_SENT"
        );
      };

      ws.onmessage = async (
        event
      ) => {
        try {
          let rawData = "";

          if (
            typeof event.data ===
            "string"
          ) {
            rawData = event.data;
          } else if (
            event.data instanceof Blob
          ) {
            rawData =
              await event.data.text();
          } else {
            return;
          }

          const data =
            JSON.parse(rawData);

          console.log(
            "SERVER_MESSAGE",
            data
          );

          if (
            data.setupComplete
          ) {
            console.log(
              "SETUP_COMPLETE"
            );

            await startMicrophone();
            return;
          }

          if (data.error) {
            console.error(
              "GEMINI_ERROR",
              data.error
            );

            setStatus("ERROR");

            setMessage(
              data.error.message ||
                "Gemini mengirim error."
            );

            return;
          }

          const serverContent =
            data.serverContent;

          if (
            serverContent?.interrupted
          ) {
            nextPlaybackTimeRef.current = 0;

            setStatus("LISTENING");
            setMessage(
              "Respons disela. Mendengarkan..."
            );

            return;
          }

          if (
            serverContent?.inputTranscription
              ?.text
          ) {
            const text =
              serverContent
                .inputTranscription
                .text;

            setInputText(
              (current) =>
                current + text
            );
          }

          if (
            serverContent?.outputTranscription
              ?.text
          ) {
            const text =
              serverContent
                .outputTranscription
                .text;

            setOutputText(
              (current) =>
                current + text
            );
          }

          const parts =
            serverContent?.modelTurn
              ?.parts || [];

          for (
            const part of parts
          ) {
            const audioData =
              part.inlineData?.data;

            if (audioData) {
              await playPCM24k(
                audioData
              );
            }
          }

          if (
            serverContent?.turnComplete
          ) {
            setStatus(
              "LISTENING"
            );

            setMessage(
              "Mendengarkan..."
            );
          }
        } catch (error) {
          console.error(
            "MESSAGE_ERROR",
            error
          );
        }
      };

      ws.onerror = (error) => {
        console.error(
          "WEBSOCKET_ERROR",
          error
        );

        setStatus("ERROR");
        setMessage(
          "WebSocket error."
        );
      };

      ws.onclose = (event) => {
        console.log(
          "WEBSOCKET_CLOSED",
          event.code,
          event.reason
        );

        wsRef.current = null;

        if (
          event.code === 1000
        ) {
          setStatus(
            "DISCONNECTED"
          );

          setMessage(
            "Koneksi dihentikan."
          );
        } else {
          setStatus("ERROR");

          setMessage(
            `Koneksi ditutup. Code ${event.code}${
              event.reason
                ? ` - ${event.reason}`
                : ""
            }`
          );
        }
      };
    } catch (error) {
      console.error(
        "CONNECT_ERROR",
        error
      );

      setStatus("ERROR");

      setMessage(
        error instanceof Error
          ? error.message
          : "Gagal terhubung."
      );
    }
  }

  function disconnect() {
    if (
      processorRef.current
    ) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (
      inputAudioContextRef.current
    ) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current =
        null;
    }

    if (
      playbackAudioContextRef.current
    ) {
      playbackAudioContextRef.current.close();
      playbackAudioContextRef.current =
        null;
    }

    if (
      micStreamRef.current
    ) {
      micStreamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });

      micStreamRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000);
      wsRef.current = null;
    }

    nextPlaybackTimeRef.current = 0;

    setStatus(
      "DISCONNECTED"
    );

    setMessage(
      "Terputus."
    );
  }

  function changeDirection(
    newDirection: Direction
  ) {
    if (
      status !==
      "DISCONNECTED"
    ) {
      disconnect();
    }

    setInputText("");
    setOutputText("");

    setDirection(
      newDirection
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-5xl">
        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">

          {/* HEADER */}
          <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold">
                Gemini Live Translator
              </h1>

              <p className="mt-1 text-slate-400">
                Indonesia ↔ Mandarin
              </p>
            </div>

            <div className="rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-semibold">
              {status}
            </div>
          </div>

          <div className="p-6 sm:p-8">

            {/* DIRECTION */}
            <div className="grid gap-4 md:grid-cols-2">

              <button
                onClick={() =>
                  changeDirection(
                    "ID_TO_ZH"
                  )
                }
                className={`rounded-2xl border p-5 text-left transition ${
                  direction ===
                  "ID_TO_ZH"
                    ? "border-blue-500 bg-blue-600"
                    : "border-slate-800 bg-slate-950 hover:bg-slate-800"
                }`}
              >
                <div className="text-sm opacity-80">
                  Bahasa Indonesia
                </div>

                <div className="mt-2 text-lg font-bold">
                  🇮🇩 Indonesia
                  <span className="mx-3">
                    →
                  </span>
                  🇨🇳 Mandarin
                </div>
              </button>

              <button
                onClick={() =>
                  changeDirection(
                    "ZH_TO_ID"
                  )
                }
                className={`rounded-2xl border p-5 text-left transition ${
                  direction ===
                  "ZH_TO_ID"
                    ? "border-blue-500 bg-blue-600"
                    : "border-slate-800 bg-slate-950 hover:bg-slate-800"
                }`}
              >
                <div className="text-sm opacity-80">
                  Bahasa Mandarin
                </div>

                <div className="mt-2 text-lg font-bold">
                  🇨🇳 Mandarin
                  <span className="mx-3">
                    →
                  </span>
                  🇮🇩 Indonesia
                </div>
              </button>

            </div>

            {/* STATUS */}
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-6 text-center">
              <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                STATUS
              </div>

              <div className="mt-2 text-3xl font-bold">
                {status}
              </div>

              <div className="mt-2 text-slate-300">
                {message}
              </div>

              <div className="mt-2 text-sm text-slate-500">
                {directionLabel()}
              </div>
            </div>

            {/* TRANSCRIPT */}
            <div className="mt-6 grid gap-4 lg:grid-cols-2">

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
                <div className="font-semibold">
                  🎙️ Bahasa Asli
                </div>

                <div className="mt-4 min-h-40 rounded-xl bg-slate-900 p-4 text-slate-200 whitespace-pre-wrap">
                  {inputText ||
                    "Menunggu suara..."}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
                <div className="font-semibold">
                  🔊 Hasil Terjemahan
                </div>

                <div className="mt-4 min-h-40 rounded-xl bg-slate-900 p-4 text-slate-200 whitespace-pre-wrap">
                  {outputText ||
                    "Menunggu terjemahan..."}
                </div>
              </div>

            </div>

            {/* BUTTONS */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">

              <button
                onClick={connect}
                disabled={
                  status ===
                    "CONNECTING" ||
                  status ===
                    "LISTENING" ||
                  status ===
                    "SPEAKING"
                }
                className="flex-1 rounded-xl bg-blue-600 px-6 py-4 font-bold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                🎙️ START
              </button>

              <button
                onClick={disconnect}
                className="flex-1 rounded-xl bg-slate-700 px-6 py-4 font-bold transition hover:bg-slate-600"
              >
                ⏹ STOP
              </button>

            </div>

          </div>
        </div>
      </div>
    </main>
  );
}