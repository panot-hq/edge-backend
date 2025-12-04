import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

export const llm = new ChatOpenAI({
  model: "gpt-5-mini",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
  modelKwargs: {
    reasoning_effort: "minimal",
  },
});

export const orchestratorLLM = new ChatOpenAI({
  model: "gpt-5-mini",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
  modelKwargs: {
    reasoning_effort: "minimal",
  },
});

export const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});
