export type ModelStatus = "installed" | "available" | "downloading" | "failed";

export type DownloadedModel = {
  id: string;
  name: string;
  provider: string;
  version: string;
  size: string;
  status: ModelStatus;
  path?: string;
  lastUsed?: string;
};

export const defaultModels: DownloadedModel[] = [
  {
    id: "gpt-4o-mini",
    name: "gpt-4o-mini",
    provider: "OpenAI",
    version: "2024-07-18",
    size: "245 MB",
    status: "installed",
    path: "~/models/gpt-4o-mini",
    lastUsed: "2 mins ago",
  },
  {
    id: "phi-3-mini",
    name: "phi-3-mini",
    provider: "Ollama",
    version: "3.8b",
    size: "2.3 GB",
    status: "available",
  },
  {
    id: "mistral-7b",
    name: "mistral-7b",
    provider: "Hugging Face",
    version: "7B",
    size: "14 GB",
    status: "available",
  },
];