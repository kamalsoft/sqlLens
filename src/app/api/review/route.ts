import { NextResponse } from "next/server";
import { pipeline } from "@huggingface/transformers";
import { getInstalledModels } from "@/lib/installed-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ReviewRequest = {
  modelId?: string;
  sql?: string;
};

const pipelines = new Map<string, Promise<unknown>>();

async function getModelPipeline(directory: string) {
  let loaded = pipelines.get(directory);

  if (!loaded) {
    loaded = pipeline("text-generation", directory, {
      dtype: "q4",
      device: "cpu",
    });

    pipelines.set(directory, loaded);
  }

  return loaded;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReviewRequest;
    const sql = body.sql?.trim();

    if (!body.modelId || !sql) {
      return NextResponse.json(
        { error: "modelId and sql are required" },
        { status: 400 }
      );
    }

    const models = await getInstalledModels();
    const model = models.find((item) => item.id === body.modelId);

    if (!model) {
      return NextResponse.json(
        { error: "The selected model is not installed" },
        { status: 404 }
      );
    }

    if (!model.compatible) {
      return NextResponse.json(
        {
          error:
            `Model "${model.name}" is downloaded but cannot run locally. ` +
            "An ONNX file is required under the model's onnx directory.",
        },
        { status: 422 }
      );
    }

    const generator = (await getModelPipeline(model.directory)) as (
      prompt: string,
      options: {
        max_new_tokens: number;
        temperature: number;
        do_sample: boolean;
        return_full_text: boolean;
      }
    ) => Promise<Array<{ generated_text?: string }>>;

    const prompt = `You are an expert SQL Server performance reviewer.
Analyze the following stored procedure.

Return valid JSON only with this schema:
{
  "summary": "string",
  "issues": [
    {
      "severity": "critical|high|medium|low",
      "title": "string",
      "explanation": "string",
      "recommendation": "string"
    }
  ],
  "rewrittenProcedure": "string",
  "confidence": 0
}

Stored procedure:
<sql>
${sql}
</sql>`;

    const output = await generator(prompt, {
      max_new_tokens: 1200,
      temperature: 0.2,
      do_sample: false,
      return_full_text: false,
    });

    const text = output[0]?.generated_text?.trim();

    if (!text) {
      throw new Error("The selected model returned no result");
    }

    return NextResponse.json({
      model: model.id,
      result: text,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Stored procedure analysis failed",
      },
      { status: 500 }
    );
  }
}
