import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";

import { ORCHESTRATOR_PROMPT } from "./lib/orchestator_prompt.ts";

import { manageContact } from "./contact-manager/contact_manager_agent.ts";
import { manageContextGraph } from "./graph-manager/graph_manager_agent.ts";

import { orchestratorLLM } from "./lib/llm_provider.ts";

const tools = [manageContact, manageContextGraph];

export const panot_orchestrator = createAgent({
  model: orchestratorLLM as any,
  tools: tools,
  systemPrompt: ORCHESTRATOR_PROMPT,
});
