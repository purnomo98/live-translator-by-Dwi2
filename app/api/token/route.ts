import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";

export async function GET() {
  const result: {
    indonesiaToChinese?: string;
    chineseToIndonesia?: string;
    transcribe?: string;
    errors: string[];
  } = {
    errors: [],
  };

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "GEMINI_API_KEY tidak ditemukan.",
        },
        { status: 500 }
      );
    }

    const client = new GoogleGenAI({
      apiKey,
    });

    const expireTime = new Date(
      Date.now() + 30 * 60 * 1000
    ).toISOString();

    const newSessionExpireTime = new Date(
      Date.now() + 60 * 1000
    ).toISOString();

    // ========================================
    // TOKEN 1: INDONESIA -> MANDARIN
    // ========================================
    try {
      const token =
        await client.authTokens.create({
          config: {
            uses: 1,
            expireTime,
            newSessionExpireTime,

            liveConnectConstraints: {
              model:
                "gemini-3.5-live-translate-preview",

              config: {
                responseModalities: [
                  Modality.AUDIO,
                ],

                inputAudioTranscription: {},

                outputAudioTranscription: {},

                translationConfig: {
                  targetLanguageCode:
                    "zh-Hans",
                  echoTargetLanguage:
                    false,
                },
              },
            },
          },
        });

      result.indonesiaToChinese =
        token.name;

      console.log(
        "TOKEN 1 OK: ID -> ZH"
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        "TOKEN 1 ERROR:",
        message
      );

      result.errors.push(
        `ID_TO_ZH: ${message}`
      );
    }

    // ========================================
    // TOKEN 2: MANDARIN -> INDONESIA
    // ========================================
    try {
      const token =
        await client.authTokens.create({
          config: {
            uses: 1,
            expireTime,
            newSessionExpireTime,

            liveConnectConstraints: {
              model:
                "gemini-3.5-live-translate-preview",

              config: {
                responseModalities: [
                  Modality.AUDIO,
                ],

                inputAudioTranscription: {},

                outputAudioTranscription: {},

                translationConfig: {
                  targetLanguageCode:
                    "id",
                  echoTargetLanguage:
                    false,
                },
              },
            },
          },
        });

      result.chineseToIndonesia =
        token.name;

      console.log(
        "TOKEN 2 OK: ZH -> ID"
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        "TOKEN 2 ERROR:",
        message
      );

      result.errors.push(
        `ZH_TO_ID: ${message}`
      );
    }

    // ========================================
    // TOKEN 3: AUTO TRANSCRIBE
    // ========================================
    try {
      const token =
        await client.authTokens.create({
          config: {
            uses: 1,
            expireTime,
            newSessionExpireTime,

            liveConnectConstraints: {
              model:
                "gemini-3.5-transcribe-live",

              config: {
                responseModalities: [
                  Modality.TEXT,
                ],

                inputAudioTranscription: {
                  languageCodes: [],
                },
              },
            },
          },
        });

      result.transcribe =
        token.name;

      console.log(
        "TOKEN 3 OK: TRANSCRIBE"
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        "TOKEN 3 ERROR:",
        message
      );

      result.errors.push(
        `TRANSCRIBE: ${message}`
      );
    }

    // ========================================
    // RETURN SELALU JSON
    // ========================================
    const success =
      Boolean(
        result.indonesiaToChinese &&
          result.chineseToIndonesia &&
          result.transcribe
      );

    return NextResponse.json(
      result,
      {
        status: success ? 200 : 500,
      }
    );
  } catch (error) {
    console.error(
      "TOKEN_ROUTE_FATAL:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}