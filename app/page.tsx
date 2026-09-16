"use client";

import { useEffect, useRef, useState } from "react";

type Status =
  | "DISCONNECTED"
  | "CONNECTING"
  | "LISTENING"
  | "SPEAKING"
  | "ERROR";

type Direction =
  | "UNKNOWN"
  | "ID_TO_ZH"
  | "ZH_TO_ID";

type SessionName =
  | "ID_TO_ZH"
  | "ZH_TO_ID";

type SetupFlags = {
  id: boolean;
  zh: boolean;
  transcribe: boolean;
};

export default function Home() {
  const [status, setStatus] =
    useState<Status>("DISCONNECTED");

  const [message, setMessage] =
    useState("Belum terhubung.");

  const [direction, setDirection] =
    useState<Direction>("UNKNOWN");

  const [inputText, setInputText] =
    useState("");

  const [outputText, setOutputText] =
    useState("");

  const [idConnected, setIdConnected] =
    useState(false);

  const [zhConnected, setZhConnected] =
    useState(false);

  const [transcribeConnected, setTranscribeConnected] =
    useState(false);

  // =========================
  // WEBSOCKET REFERENCES
  // =========================

  const idWsRef =
    useRef<WebSocket | null>(null);

  const zhWsRef =
    useRef<WebSocket | null>(null);

  const transcribeWsRef =
    useRef<WebSocket | null>(null);

  // =========================
  // MICROPHONE REFERENCES
  // =========================

  const micStreamRef =
    useRef<MediaStream | null>(null);

  const micContextRef =
    useRef<AudioContext | null>(null);

  const micSourceRef =
    useRef<MediaStreamAudioSourceNode | null>(
      null
    );

  const processorRef =
    useRef<ScriptProcessorNode | null>(
      null
    );

  // =========================
  // PLAYBACK REFERENCES
  // =========================

  const playbackContextRef =
    useRef<AudioContext | null>(null);

  const playingSourcesRef =
    useRef<Set<AudioBufferSourceNode>>(
      new Set()
    );

  const nextPlaybackTimeRef =
    useRef(0);

  // =========================
  // STATE REFERENCES
  // =========================

  const activeDirectionRef =
    useRef<Direction>("UNKNOWN");

  const setupRef =
    useRef<SetupFlags>({
      id: false,
      zh: false,
      transcribe: false,
    });

  const microphoneStartedRef =
    useRef(false);

  const currentInputRef =
    useRef("");

  const currentOutputRef =
    useRef("");

  // Audio chunks sementara sebelum bahasa diketahui.
  const pendingAudioChunksRef =
    useRef<string[]>([]);

  // Maksimum buffer sekitar beberapa detik.
  const MAX_PENDING_CHUNKS = 80;

  const mountedRef =
    useRef(true);

  // Digunakan supaya translator yang salah
  // tidak memutar audio.
  const turnIdRef =
    useRef(0);

  const activeTurnIdRef =
    useRef(0);

  // =========================
  // CLEANUP
  // =========================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, []);

  function closeSocket(
    socket: WebSocket | null
  ) {
    if (!socket) {
      return;
    }

    try {
      socket.close(1000);
    } catch {
      // ignore
    }
  }

  function stopPlayback() {
    for (
      const source of
        playingSourcesRef.current
    ) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }

    playingSourcesRef.current.clear();
    nextPlaybackTimeRef.current = 0;
  }

  function cleanup() {
    microphoneStartedRef.current = false;

    stopPlayback();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {}

      processorRef.current = null;
    }

    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch {}

      micSourceRef.current = null;
    }

    if (micContextRef.current) {
      void micContextRef.current.close();
      micContextRef.current = null;
    }

    if (playbackContextRef.current) {
      void playbackContextRef.current.close();
      playbackContextRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current
        .getTracks()
        .forEach((track) => track.stop());

      micStreamRef.current = null;
    }

    closeSocket(idWsRef.current);
    closeSocket(zhWsRef.current);
    closeSocket(transcribeWsRef.current);

    idWsRef.current = null;
    zhWsRef.current = null;
    transcribeWsRef.current = null;

    setupRef.current = {
      id: false,
      zh: false,
      transcribe: false,
    };

    activeDirectionRef.current =
      "UNKNOWN";

    currentInputRef.current = "";
    currentOutputRef.current = "";

    pendingAudioChunksRef.current = [];

    turnIdRef.current += 1;
    activeTurnIdRef.current =
      turnIdRef.current;
  }

  // =========================
  // LANGUAGE DETECTION
  // =========================

  function detectDirectionFromText(
    text: string
  ): Direction {
    const clean =
      text.trim();

    if (!clean) {
      return "UNKNOWN";
    }

    const hanCount =
      (
        clean.match(
          /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g
        ) || []
      ).length;

    const latinCount =
      (
        clean.match(
          /[A-Za-zÀ-ÿ]/g
        ) || []
      ).length;

    // Mandarin
    if (
      hanCount >= 2 &&
      hanCount >= latinCount
    ) {
      return "ZH_TO_ID";
    }

    // Indonesia / Latin
    if (
      latinCount >= 3 &&
      latinCount > hanCount
    ) {
      return "ID_TO_ZH";
    }

    return "UNKNOWN";
  }

  function setActiveDirection(
    newDirection: Direction
  ) {
    if (
      newDirection ===
      "UNKNOWN"
    ) {
      return;
    }

    if (
      activeDirectionRef.current !==
      newDirection
    ) {
      stopPlayback();

      currentOutputRef.current =
        "";

      setOutputText("");
    }

    activeDirectionRef.current =
      newDirection;

    setDirection(
      newDirection
    );

    if (
      newDirection ===
      "ID_TO_ZH"
    ) {
      setMessage(
        "🇮🇩 Indonesia terdeteksi → menerjemahkan ke Mandarin..."
      );
    } else {
      setMessage(
        "🇨🇳 Mandarin terdeteksi → menerjemahkan ke Indonesia..."
      );
    }
  }

  // =========================
  // SEND AUDIO BUFFER
  // =========================

  function sendAudioToSession(
    session: SessionName,
    payload: string
  ) {
    const socket =
      session ===
      "ID_TO_ZH"
        ? idWsRef.current
        : zhWsRef.current;

    if (
      socket &&
      socket.readyState ===
        WebSocket.OPEN
    ) {
      socket.send(payload);
    }
  }

  function sendPendingAudio(
    session: SessionName
  ) {
    const chunks =
      pendingAudioChunksRef.current;

    if (
      chunks.length === 0
    ) {
      return;
    }

    console.log(
      `Sending ${chunks.length} buffered chunks to ${session}`
    );

    for (
      const chunk of chunks
    ) {
      sendAudioToSession(
        session,
        chunk
      );
    }

    pendingAudioChunksRef.current =
      [];
  }

  // =========================
  // PLAY AUDIO
  // =========================

  async function playPCM24k(
    base64Audio: string,
    session: SessionName,
    turnId: number
  ) {
    // Jangan putar hasil dari sesi yang salah.
    if (
      activeDirectionRef.current !==
      session
    ) {
      return;
    }

    if (
      activeTurnIdRef.current !==
      turnId
    ) {
      return;
    }

    try {
      if (
        !playbackContextRef.current
      ) {
        playbackContextRef.current =
          new AudioContext();
      }

      const context =
        playbackContextRef.current;

      if (
        context.state ===
        "suspended"
      ) {
        await context.resume();
      }

      const binary =
        atob(base64Audio);

      const usableLength =
        binary.length -
        (binary.length % 2);

      if (
        usableLength <= 0
      ) {
        return;
      }

      const buffer =
        new ArrayBuffer(
          usableLength
        );

      const bytes =
        new Uint8Array(buffer);

      for (
        let i = 0;
        i < usableLength;
        i++
      ) {
        bytes[i] =
          binary.charCodeAt(i);
      }

      const pcm =
        new Int16Array(buffer);

      // Float32Array dengan ArrayBuffer asli
      // untuk menghindari error TypeScript.
      const samples =
        new Float32Array(
          new ArrayBuffer(
            pcm.length * 4
          )
        );

      for (
        let i = 0;
        i < pcm.length;
        i++
      ) {
        samples[i] =
          pcm[i] < 0
            ? pcm[i] / 0x8000
            : pcm[i] / 0x7fff;
      }

      // Gemini output = 24 kHz PCM
      const audioBuffer =
        context.createBuffer(
          1,
          samples.length,
          24000
        );

      audioBuffer.copyToChannel(
        samples,
        0
      );

      const source =
        context.createBufferSource();

      source.buffer =
        audioBuffer;

      source.connect(
        context.destination
      );

      const now =
        context.currentTime;

      if (
        nextPlaybackTimeRef.current <
        now
      ) {
        nextPlaybackTimeRef.current =
          now;
      }

      source.start(
        nextPlaybackTimeRef.current
      );

      nextPlaybackTimeRef.current +=
        audioBuffer.duration;

      playingSourcesRef.current.add(
        source
      );

      setStatus(
        "SPEAKING"
      );

      source.onended =
        () => {
          playingSourcesRef.current.delete(
            source
          );

          if (
            mountedRef.current &&
            activeDirectionRef.current ===
              session &&
            activeTurnIdRef.current ===
              turnId &&
            context.currentTime >=
              nextPlaybackTimeRef.current -
                0.05
          ) {
            setStatus(
              "LISTENING"
            );

            setMessage(
              "Mendengarkan..."
            );
          }
        };
    } catch (error) {
      console.error(
        "PLAYBACK_ERROR",
        error
      );
    }
  }

  // =========================
  // TRANSLATION MESSAGE
  // =========================

  async function handleTranslationMessage(
    session: SessionName,
    event: MessageEvent
  ) {
    try {
      let raw = "";

      if (
        typeof event.data ===
        "string"
      ) {
        raw =
          event.data;
      } else if (
        event.data instanceof Blob
      ) {
        raw =
          await event.data.text();
      } else {
        return;
      }

      const data =
        JSON.parse(raw);

      console.log(
        `[${session}]`,
        data
      );

      if (
        data.setupComplete
      ) {
        console.log(
          `${session}: SETUP_COMPLETE`
        );

        return;
      }

      if (
        data.error
      ) {
        console.error(
          `${session}: GEMINI_ERROR`,
          data.error
        );

        if (
          mountedRef.current
        ) {
          setStatus(
            "ERROR"
          );

          setMessage(
            data.error.message ||
              `${session} error`
          );
        }

        return;
      }

      const content =
        data.serverContent;

      if (!content) {
        return;
      }

      // User interruption
      if (
        content.interrupted
      ) {
        stopPlayback();

        if (
          activeDirectionRef.current ===
          session
        ) {
          setStatus(
            "LISTENING"
          );

          setMessage(
            "Respons dihentikan. Mendengarkan..."
          );
        }

        return;
      }

      // Input transcript
      const inputChunk =
        content
          .inputTranscription
          ?.text || "";

      if (
        inputChunk &&
        activeDirectionRef.current ===
          session
      ) {
        currentInputRef.current +=
          inputChunk;

        setInputText(
          currentInputRef.current
        );
      }

      // Output transcript
      const outputChunk =
        content
          .outputTranscription
          ?.text || "";

      if (
        outputChunk &&
        activeDirectionRef.current ===
          session
      ) {
        currentOutputRef.current +=
          outputChunk;

        setOutputText(
          currentOutputRef.current
        );
      }

      // AUDIO
      const parts =
        content
          .modelTurn
          ?.parts || [];

      for (
        const part of parts
      ) {
        const audio =
          part.inlineData
            ?.data;

        if (!audio) {
          continue;
        }

        const currentTurn =
          activeTurnIdRef.current;

        await playPCM24k(
          audio,
          session,
          currentTurn
        );
      }

      if (
        content.turnComplete &&
        activeDirectionRef.current ===
          session
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
        `${session}: MESSAGE_ERROR`,
        error
      );
    }
  }

  // =========================
  // TRANSCRIPTION MESSAGE
  // =========================

  async function handleTranscriptionMessage(
    event: MessageEvent
  ) {
    try {
      let raw = "";

      if (
        typeof event.data ===
        "string"
      ) {
        raw =
          event.data;
      } else if (
        event.data instanceof Blob
      ) {
        raw =
          await event.data.text();
      } else {
        return;
      }

      const data =
        JSON.parse(raw);

      console.log(
        "[TRANSCRIBE]",
        data
      );

      if (
        data.setupComplete
      ) {
        console.log(
          "TRANSCRIBE: SETUP_COMPLETE"
        );

        return;
      }

      if (
        data.error
      ) {
        console.error(
          "TRANSCRIBE_ERROR",
          data.error
        );

        setStatus(
          "ERROR"
        );

        setMessage(
          data.error.message ||
            "Language detector error."
        );

        return;
      }

      const content =
        data.serverContent;

      if (!content) {
        return;
      }

      /*
       * Interim transcript:
       * ini yang kita gunakan untuk
       * menentukan arah secepat mungkin.
       */
      const interim =
        content
          .interimInputTranscription
          ?.text || "";

      if (interim) {
        const detected =
          detectDirectionFromText(
            interim
          );

        if (
          detected !==
          "UNKNOWN"
        ) {
          if (
            activeDirectionRef.current !==
            detected
          ) {
            setActiveDirection(
              detected
            );

            activeTurnIdRef.current +=
              1;

            currentInputRef.current =
              interim;

            currentOutputRef.current =
              "";

            setInputText(
              interim
            );

            setOutputText("");

            /*
             * Sekarang kirim seluruh
             * audio yang sudah kita buffer
             * ke translator yang benar.
             */
            sendPendingAudio(
              detected
            );
          } else {
            currentInputRef.current =
              interim;

            setInputText(
              interim
            );
          }
        }

        return;
      }

      /*
       * Final transcript
       */
      const finalChunk =
        content
          .inputTranscription
          ?.text || "";

      if (
        finalChunk
      ) {
        const combined =
          currentInputRef.current +
          finalChunk;

        currentInputRef.current =
          combined;

        setInputText(
          combined
        );

        const detected =
          detectDirectionFromText(
            combined
          );

        if (
          detected !==
          "UNKNOWN"
        ) {
          if (
            activeDirectionRef.current !==
            detected
          ) {
            setActiveDirection(
              detected
            );

            activeTurnIdRef.current +=
              1;

            sendPendingAudio(
              detected
            );
          }
        }
      }

      /*
       * Turn complete
       */
      if (
        content.turnComplete
      ) {
        setStatus(
          "LISTENING"
        );

        setMessage(
          "Mendengarkan..."
        );

        /*
         * Setelah giliran selesai,
         * arah direset agar lawan bicara
         * bisa menggunakan bahasa lain.
         */
        window.setTimeout(
          () => {
            if (
              mountedRef.current
            ) {
              activeDirectionRef.current =
                "UNKNOWN";

              currentInputRef.current =
                "";

              currentOutputRef.current =
                "";

              pendingAudioChunksRef.current =
                [];

              setDirection(
                "UNKNOWN"
              );

              setInputText("");
              setOutputText("");

              setMessage(
                "Mendeteksi bahasa berikutnya..."
              );
            }
          },
          300
        );
      }
    } catch (error) {
      console.error(
        "TRANSCRIBE_MESSAGE_ERROR",
        error
      );
    }
  }

  // =========================
  // MICROPHONE
  // =========================

  async function startMicrophone() {
    if (
      microphoneStartedRef.current
    ) {
      return;
    }

    const idWs =
      idWsRef.current;

    const zhWs =
      zhWsRef.current;

    const transcribeWs =
      transcribeWsRef.current;

    if (
      !idWs ||
      !zhWs ||
      !transcribeWs
    ) {
      throw new Error(
        "WebSocket belum lengkap."
      );
    }

    if (
      idWs.readyState !==
        WebSocket.OPEN ||
      zhWs.readyState !==
        WebSocket.OPEN ||
      transcribeWs.readyState !==
        WebSocket.OPEN
    ) {
      throw new Error(
        "Semua WebSocket belum siap."
      );
    }

    microphoneStartedRef.current =
      true;

    const stream =
      await navigator.mediaDevices.getUserMedia(
        {
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }
      );

    micStreamRef.current =
      stream;

    const context =
      new AudioContext();

    micContextRef.current =
      context;

    if (
      context.state ===
      "suspended"
    ) {
      await context.resume();
    }

    const source =
      context.createMediaStreamSource(
        stream
      );

    micSourceRef.current =
      source;

    /*
     * 2048 frame.
     */
    const processor =
      context.createScriptProcessor(
        2048,
        1,
        1
      );

    processorRef.current =
      processor;

    processor.onaudioprocess =
      (event) => {
        const input =
          event.inputBuffer.getChannelData(
            0
          );

        const inputRate =
          context.sampleRate;

        const targetRate =
          16000;

        const ratio =
          inputRate /
          targetRate;

        const outputLength =
          Math.round(
            input.length /
              ratio
          );

        const resampled =
          new Float32Array(
            outputLength
          );

        for (
          let i = 0;
          i < outputLength;
          i++
        ) {
          const start =
            Math.floor(
              i * ratio
            );

          const end =
            Math.min(
              Math.floor(
                (i + 1) * ratio
              ),
              input.length
            );

          let sum = 0;
          let count = 0;

          for (
            let j = start;
            j < end;
            j++
          ) {
            sum += input[j];
            count++;
          }

          resampled[i] =
            count > 0
              ? sum / count
              : 0;
        }

        const pcm =
          new Int16Array(
            new ArrayBuffer(
              resampled.length *
                2
            )
          );

        for (
          let i = 0;
          i < resampled.length;
          i++
        ) {
          const sample =
            Math.max(
              -1,
              Math.min(
                1,
                resampled[i]
              )
            );

          pcm[i] =
            sample < 0
              ? sample * 0x8000
              : sample * 0x7fff;
        }

        const bytes =
          new Uint8Array(
            pcm.buffer
          );

        let binary = "";

        const chunkSize =
          0x8000;

        for (
          let i = 0;
          i < bytes.length;
          i += chunkSize
        ) {
          const chunk =
            bytes.subarray(
              i,
              Math.min(
                i +
                  chunkSize,
                bytes.length
              )
            );

          binary +=
            String.fromCharCode(
              ...chunk
            );
        }

        const payload =
          JSON.stringify({
            realtimeInput: {
              audio: {
                data:
                  btoa(binary),
                mimeType:
                  "audio/pcm;rate=16000",
              },
            },
          });

        /*
         * 1. Selalu kirim ke transcriber
         */
        if (
          transcribeWs.readyState ===
          WebSocket.OPEN
        ) {
          transcribeWs.send(
            payload
          );
        }

        /*
         * 2. Jika bahasa belum diketahui,
         * simpan audio sementara.
         */
        if (
          activeDirectionRef.current ===
          "UNKNOWN"
        ) {
          pendingAudioChunksRef.current.push(
            payload
          );

          if (
            pendingAudioChunksRef.current
              .length >
            MAX_PENDING_CHUNKS
          ) {
            pendingAudioChunksRef.current.shift();
          }

          return;
        }

        /*
         * 3. Setelah bahasa diketahui,
         * hanya kirim ke translator yang benar.
         */
        if (
          activeDirectionRef.current ===
          "ID_TO_ZH"
        ) {
          if (
            idWs.readyState ===
            WebSocket.OPEN
          ) {
            idWs.send(
              payload
            );
          }
        } else if (
          activeDirectionRef.current ===
          "ZH_TO_ID"
        ) {
          if (
            zhWs.readyState ===
            WebSocket.OPEN
          ) {
            zhWs.send(
              payload
            );
          }
        }
      };

    source.connect(
      processor
    );

    /*
     * ScriptProcessor perlu terhubung ke
     * destination agar callback tetap aktif.
     */
    processor.connect(
      context.destination
    );

    setStatus(
      "LISTENING"
    );

    setMessage(
      "Mendengarkan dan mendeteksi bahasa..."
    );

    console.log(
      "MIC_STARTED",
      context.sampleRate
    );
  }

  // =========================
  // SETUP HELPER
  // =========================

  function markSetup(
    name: keyof SetupFlags
  ) {
    setupRef.current[name] =
      true;

    console.log(
      `SETUP_COMPLETE: ${name}`
    );

    const ready =
      setupRef.current.id &&
      setupRef.current.zh &&
      setupRef.current.transcribe;

    if (
      ready &&
      !microphoneStartedRef.current
    ) {
      void startMicrophone().catch(
        (error) => {
          console.error(
            "START_MIC_ERROR",
            error
          );

          setStatus(
            "ERROR"
          );

          setMessage(
            error instanceof Error
              ? error.message
              : "Gagal memulai microphone."
          );
        }
      );
    }
  }

  function parseMessageData(
    event: MessageEvent
  ): Promise<string> | string {
    if (
      typeof event.data ===
      "string"
    ) {
      return event.data;
    }

    if (
      event.data instanceof Blob
    ) {
      return event.data.text();
    }

    return "";
  }

  // =========================
  // CONNECT
  // =========================

  async function connect() {
    try {
      cleanup();

      setStatus(
        "CONNECTING"
      );

      setMessage(
        "Meminta ephemeral token..."
      );

      setDirection(
        "UNKNOWN"
      );

      setInputText("");
      setOutputText("");

      const response =
        await fetch(
          "/api/token",
          {
            cache:
              "no-store",
          }
        );

      const rawResponse =
        await response.text();

      let tokens: Record<
        string,
        string
      >;

      try {
        tokens =
          JSON.parse(
            rawResponse
          );
      } catch {
        throw new Error(
          "Server /api/token tidak mengembalikan JSON."
        );
      }

      if (
        !response.ok
      ) {
        throw new Error(
          tokens.error ||
            "Gagal mendapatkan token."
        );
      }

      if (
        !tokens
          .indonesiaToChinese ||
        !tokens
          .chineseToIndonesia ||
        !tokens.transcribe
      ) {
        throw new Error(
          "Tiga token Gemini tidak lengkap."
        );
      }

      const baseUrl =
        "wss://generativelanguage.googleapis.com/ws/" +
        "google.ai.generativelanguage.v1beta.GenerativeService." +
        "BidiGenerateContentConstrained?access_token=";

      const idWs =
        new WebSocket(
          baseUrl +
            encodeURIComponent(
              tokens
                .indonesiaToChinese
            )
        );

      const zhWs =
        new WebSocket(
          baseUrl +
            encodeURIComponent(
              tokens
                .chineseToIndonesia
            )
        );

      const transcribeWs =
        new WebSocket(
          baseUrl +
            encodeURIComponent(
              tokens.transcribe
            )
        );

      idWsRef.current =
        idWs;

      zhWsRef.current =
        zhWs;

      transcribeWsRef.current =
        transcribeWs;

      // =========================
      // ID -> ZH
      // =========================

      idWs.onopen = () => {
        console.log(
          "ID_TO_ZH: WEBSOCKET_OPEN"
        );

        setIdConnected(true);

        idWs.send(
          JSON.stringify({
            setup: {
              model:
                "models/gemini-3.5-live-translate-preview",

              generationConfig: {
                responseModalities: [
                  "AUDIO",
                ],

                translationConfig: {
                  targetLanguageCode:
                    "zh-Hans",

                  echoTargetLanguage:
                    false,
                },
              },

              inputAudioTranscription:
                {},

              outputAudioTranscription:
                {},
            },
          })
        );
      };

      // =========================
      // ZH -> ID
      // =========================

      zhWs.onopen = () => {
        console.log(
          "ZH_TO_ID: WEBSOCKET_OPEN"
        );

        setZhConnected(true);

        zhWs.send(
          JSON.stringify({
            setup: {
              model:
                "models/gemini-3.5-live-translate-preview",

              generationConfig: {
                responseModalities: [
                  "AUDIO",
                ],

                translationConfig: {
                  targetLanguageCode:
                    "id",

                  echoTargetLanguage:
                    false,
                },
              },

              inputAudioTranscription:
                {},

              outputAudioTranscription:
                {},
            },
          })
        );
      };

      // =========================
      // TRANSCRIBER
      // =========================

      transcribeWs.onopen =
        () => {
          console.log(
            "TRANSCRIBE: WEBSOCKET_OPEN"
          );

          setTranscribeConnected(
            true
          );

          transcribeWs.send(
            JSON.stringify({
              setup: {
                model:
                  "models/gemini-3.5-transcribe-live",

                generationConfig: {
                  responseModalities: [
                    "TEXT",
                  ],
                },

                inputAudioTranscription: {
                  languageCodes: [],
                },
              },
            })
          );
        };

      // =========================
      // ID MESSAGE
      // =========================

      idWs.onmessage =
        async (event) => {
          try {
            const raw =
              await parseMessageData(
                event
              );

            const data =
              JSON.parse(raw);

            if (
              data.setupComplete
            ) {
              markSetup("id");
              return;
            }

            await handleTranslationMessage(
              "ID_TO_ZH",
              event
            );
          } catch (error) {
            console.error(
              "ID_WS_MESSAGE_ERROR",
              error
            );
          }
        };

      // =========================
      // ZH MESSAGE
      // =========================

      zhWs.onmessage =
        async (event) => {
          try {
            const raw =
              await parseMessageData(
                event
              );

            const data =
              JSON.parse(raw);

            if (
              data.setupComplete
            ) {
              markSetup("zh");
              return;
            }

            await handleTranslationMessage(
              "ZH_TO_ID",
              event
            );
          } catch (error) {
            console.error(
              "ZH_WS_MESSAGE_ERROR",
              error
            );
          }
        };

      // =========================
      // TRANSCRIBE MESSAGE
      // =========================

      transcribeWs.onmessage =
        async (event) => {
          try {
            const raw =
              await parseMessageData(
                event
              );

            const data =
              JSON.parse(raw);

            if (
              data.setupComplete
            ) {
              markSetup(
                "transcribe"
              );
              return;
            }

            await handleTranscriptionMessage(
              event
            );
          } catch (error) {
            console.error(
              "TRANSCRIBE_WS_MESSAGE_ERROR",
              error
            );
          }
        };

      // =========================
      // ERRORS
      // =========================

      idWs.onerror =
        (error) => {
          console.error(
            "ID_TO_ZH_WEBSOCKET_ERROR",
            error
          );
        };

      zhWs.onerror =
        (error) => {
          console.error(
            "ZH_TO_ID_WEBSOCKET_ERROR",
            error
          );
        };

      transcribeWs.onerror =
        (error) => {
          console.error(
            "TRANSCRIBE_WEBSOCKET_ERROR",
            error
          );
        };

      // =========================
      // CLOSE
      // =========================

      idWs.onclose =
        (event) => {
          console.log(
            "ID_TO_ZH_CLOSED",
            event.code,
            event.reason
          );

          setIdConnected(false);

          if (
            event.code !==
              1000 &&
            mountedRef.current
          ) {
            setStatus(
              "ERROR"
            );

            setMessage(
              `Indonesia → Mandarin terputus. Code ${event.code}${
                event.reason
                  ? ` - ${event.reason}`
                  : ""
              }`
            );
          }
        };

      zhWs.onclose =
        (event) => {
          console.log(
            "ZH_TO_ID_CLOSED",
            event.code,
            event.reason
          );

          setZhConnected(false);

          if (
            event.code !==
              1000 &&
            mountedRef.current
          ) {
            setStatus(
              "ERROR"
            );

            setMessage(
              `Mandarin → Indonesia terputus. Code ${event.code}${
                event.reason
                  ? ` - ${event.reason}`
                  : ""
              }`
            );
          }
        };

      transcribeWs.onclose =
        (event) => {
          console.log(
            "TRANSCRIBE_CLOSED",
            event.code,
            event.reason
          );

          setTranscribeConnected(
            false
          );

          if (
            event.code !==
              1000 &&
            mountedRef.current
          ) {
            setStatus(
              "ERROR"
            );

            setMessage(
              `Language detector terputus. Code ${event.code}${
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

      setStatus(
        "ERROR"
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Gagal terhubung."
      );
    }
  }

  // =========================
  // DISCONNECT
  // =========================

  function disconnect() {
    cleanup();

    setIdConnected(false);
    setZhConnected(false);
    setTranscribeConnected(false);

    setStatus(
      "DISCONNECTED"
    );

    setDirection(
      "UNKNOWN"
    );

    setInputText("");
    setOutputText("");

    setMessage(
      "Terputus."
    );
  }

  // =========================
  // UI
  // =========================

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <div className="mx-auto w-full max-w-5xl">

        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">

          {/* HEADER */}
          <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">

            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">
                Gemini Live Translator
              </h1>

              <p className="mt-1 text-sm text-slate-400">
                Indonesia ↔ Mandarin
              </p>
            </div>

            <div className="rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-bold">
              {status}
            </div>

          </div>

          <div className="p-6 sm:p-8">

            {/* AUTO MODE */}
            <div className="rounded-2xl border border-blue-500/30 bg-blue-950/20 p-5">

              <div className="text-sm font-semibold text-blue-300">
                🔄 AUTO TRANSLATION
              </div>

              <div className="mt-2 text-xl font-bold">
                Indonesia ↔ Mandarin
              </div>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                Tidak perlu memilih arah.
                Bahasa dideteksi otomatis
                saat kamu berbicara.
              </p>

            </div>

            {/* LANGUAGE */}
            <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-6 text-center">

              <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                BAHASA TERDETEKSI
              </div>

              <div className="mt-3 text-2xl font-bold">
                {direction ===
                  "ID_TO_ZH" &&
                  "🇮🇩 Indonesia"}

                {direction ===
                  "ZH_TO_ID" &&
                  "🇨🇳 Mandarin"}

                {direction ===
                  "UNKNOWN" &&
                  "Menunggu bahasa..."}
              </div>

              <div className="mt-3 text-sm text-slate-300">
                {message}
              </div>

            </div>

            {/* TRANSCRIPT */}
            <div className="mt-6 grid gap-4 lg:grid-cols-2">

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">

                <div className="font-semibold">
                  🎙️ Bahasa Asli
                </div>

                <div className="mt-4 min-h-44 rounded-xl bg-slate-900 p-4 text-slate-200 whitespace-pre-wrap">
                  {inputText ||
                    "Menunggu suara..."}
                </div>

              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">

                <div className="font-semibold">
                  🔊 Hasil Terjemahan
                </div>

                <div className="mt-4 min-h-44 rounded-xl bg-slate-900 p-4 text-slate-200 whitespace-pre-wrap">
                  {outputText ||
                    "Menunggu terjemahan..."}
                </div>

              </div>

            </div>

            {/* BUTTONS */}
            <div className="mt-6 flex gap-3">

              <button
                onClick={() => {
                  void connect();
                }}
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
                onClick={
                  disconnect
                }
                className="flex-1 rounded-xl bg-slate-700 px-6 py-4 font-bold transition hover:bg-slate-600"
              >
                ⏹ STOP
              </button>

            </div>

            {/* CONNECTION STATUS */}
            <div className="mt-5 grid gap-3 md:grid-cols-3">

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-center">

                <div className="text-xs text-slate-500">
                  TRANSLATOR 1
                </div>

                <div className="mt-1 font-semibold">
                  🇮🇩 → 🇨🇳
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  {idConnected
                    ? "Connected"
                    : "Disconnected"}
                </div>

              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-center">

                <div className="text-xs text-slate-500">
                  TRANSLATOR 2
                </div>

                <div className="mt-1 font-semibold">
                  🇨🇳 → 🇮🇩
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  {zhConnected
                    ? "Connected"
                    : "Disconnected"}
                </div>

              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-center">

                <div className="text-xs text-slate-500">
                  LANGUAGE DETECTOR
                </div>

                <div className="mt-1 font-semibold">
                  AUTO
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  {transcribeConnected
                    ? "Connected"
                    : "Disconnected"}
                </div>

              </div>

            </div>

          </div>
        </div>
      </div>
    </main>
  );
}