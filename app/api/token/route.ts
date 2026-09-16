import { GoogleGenAI, Modality } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest
) {
  try {
    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY tidak ditemukan.",
        },
        { status: 500 }
      );
    }

    const direction =
      request.nextUrl.searchParams.get(
        "direction"
      ) || "ID_TO_ZH";

    const targetLanguageCode =
      direction === "ZH_TO_ID"
        ? "id"
        : "zh-Hans";

    const client =
      new GoogleGenAI({
        apiKey,
      });

    const token =
      await client.authTokens.create({
        config: {
          uses: 1,

          expireTime:
            new Date(
              Date.now() +
                30 * 60 * 1000
            ).toISOString(),

          newSessionExpireTime:
            new Date(
              Date.now() +
                60 * 1000
            ).toISOString(),

          liveConnectConstraints: {
            model:
              "gemini-3.5-live-translate-preview",

            config: {
              responseModalities: [
                Modality.AUDIO,
              ],

              translationConfig: {
                targetLanguageCode,
                echoTargetLanguage: false,
              },

              inputAudioTranscription: {},

              outputAudioTranscription: {},
            },
          },
        },
      });

    return NextResponse.json({
      token: token.name,
      direction,
      targetLanguageCode,
    });
  } catch (error) {
    console.error(
      "EPHEMERAL_TOKEN_ERROR",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal membuat ephemeral token.",
      },
      { status: 500 }
    );
  }
}