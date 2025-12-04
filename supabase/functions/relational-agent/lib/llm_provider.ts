import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

export const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

export const orchestratorLLM = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
  temperature: 0,
});

export const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});
