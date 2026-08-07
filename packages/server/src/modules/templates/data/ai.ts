import type { TemplateData } from "../types";

/** `${...}` sequences are escaped so the compose bodies keep them verbatim. */

export const aiTemplates: TemplateData[] = [
	{
		id: "ollama",
		name: "Ollama",
		description:
			"Run large language models locally — Llama, Mistral, Qwen and more behind a simple API.",
		logo: "ollama",
		tags: ["ai", "llm", "api"],
		links: {
			website: "https://ollama.com",
			github: "https://github.com/ollama/ollama",
			docs: "https://github.com/ollama/ollama/tree/main/docs",
		},
		suggestedDomain: { serviceName: "ollama", port: 11434 },
		env: [],
		compose: `services:
  ollama:
    image: ollama/ollama:latest
    restart: always
    volumes:
      - ollama-data:/root/.ollama
volumes:
  ollama-data:
`,
	},
	{
		id: "open-webui",
		name: "Open WebUI",
		description:
			"Feature-rich ChatGPT-style interface for local models — ships with an Ollama backend, supports RAG and tools.",
		logo: "https://raw.githubusercontent.com/open-webui/open-webui/main/static/static/favicon.svg",
		tags: ["ai", "llm", "chat"],
		links: {
			website: "https://openwebui.com",
			github: "https://github.com/open-webui/open-webui",
			docs: "https://docs.openwebui.com",
		},
		suggestedDomain: { serviceName: "open-webui", port: 8080 },
		env: [],
		compose: `services:
  ollama:
    image: ollama/ollama:latest
    restart: always
    volumes:
      - ollama-data:/root/.ollama
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    restart: always
    depends_on:
      - ollama
    environment:
      OLLAMA_BASE_URL: http://ollama:11434
      WEBUI_AUTH: "true"
    volumes:
      - open-webui-data:/app/backend/data
volumes:
  ollama-data:
  open-webui-data:
`,
	},
	{
		id: "flowise",
		name: "Flowise",
		description:
			"Drag-and-drop builder for LLM apps — chain prompts, tools, vector stores and agents visually.",
		logo: "langchain",
		tags: ["ai", "llm", "low-code"],
		links: {
			website: "https://flowiseai.com",
			github: "https://github.com/FlowiseAI/Flowise",
			docs: "https://docs.flowiseai.com",
		},
		suggestedDomain: { serviceName: "flowise", port: 3000 },
		env: [
			{
				key: "FLOWISE_USERNAME",
				default: "admin",
				description: "Flowise login username",
			},
			{
				key: "FLOWISE_PASSWORD",
				default: "{{generateSecret}}",
				description: "Flowise login password",
			},
		],
		compose: `services:
  flowise:
    image: flowiseai/flowise:latest
    restart: always
    environment:
      FLOWISE_USERNAME: \${FLOWISE_USERNAME}
      FLOWISE_PASSWORD: \${FLOWISE_PASSWORD}
    volumes:
      - flowise-data:/root/.flowise
volumes:
  flowise-data:
`,
	},
	{
		id: "anything-llm",
		name: "AnythingLLM",
		description:
			"All-in-one private ChatGPT — chat with documents, manage workspaces, use local or hosted models.",
		logo: "https://raw.githubusercontent.com/Mintplex-Labs/anything-llm/master/frontend/public/favicon.png",
		tags: ["ai", "llm", "rag"],
		links: {
			website: "https://anythingllm.com",
			github: "https://github.com/Mintplex-Labs/anything-llm",
			docs: "https://docs.anythingllm.com",
		},
		suggestedDomain: { serviceName: "anything-llm", port: 3001 },
		env: [],
		compose: `services:
  anything-llm:
    image: mintplexlabs/anythingllm:latest
    restart: always
    environment:
      STORAGE_DIR: /app/server/storage
    volumes:
      - anything-llm-data:/app/server/storage
volumes:
  anything-llm-data:
`,
	},
];
