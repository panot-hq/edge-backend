import { createAgent } from "langchain";

import { ORCHESTRATOR_PROMPT } from "./lib/context_prompts.ts";

import { manageContact } from "./contact-manager/contact_manager_agent.ts";
import { manageContextGraph } from "./graph-manager/graph_manager_agent.ts";

import { orchestratorLLM } from "./lib/llm_provider.ts";

const tools = [manageContact, manageContextGraph];

export const panot_orchestrator = createAgent({
  model: orchestratorLLM.model,
  tools: tools,
  systemPrompt: ORCHESTRATOR_PROMPT,
});
