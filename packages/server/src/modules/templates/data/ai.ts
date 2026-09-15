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
	{
		id: "librechat",
		name: "LibreChat",
		description:
			"Open-source ChatGPT clone — many model providers side by side, conversation search, presets and multi-user accounts.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/librechat.svg",
		tags: ["ai", "llm", "chat"],
		links: {
			website: "https://librechat.ai",
			github: "https://github.com/danny-avila/LibreChat",
			docs: "https://www.librechat.ai/docs",
		},
		suggestedDomain: { serviceName: "librechat", port: 3080 },
		env: [
			{
				key: "CREDS_KEY",
				default: "",
				description:
					"Exactly 64 hex characters used to encrypt stored provider keys (`openssl rand -hex 32`)",
			},
			{
				key: "CREDS_IV",
				default: "",
				description: "Exactly 32 hex characters paired with CREDS_KEY (`openssl rand -hex 16`)",
			},
			{
				key: "JWT_SECRET",
				default: "{{generateSecret}}",
				description: "Signing secret for session tokens",
			},
			{
				key: "JWT_REFRESH_SECRET",
				default: "{{generateSecret}}",
				description: "Signing secret for refresh tokens",
			},
			{
				key: "ALLOW_REGISTRATION",
				default: "true",
				description: "Set to false once your own account exists to close public sign-up",
			},
		],
		compose: `services:
  librechat:
    image: ghcr.io/danny-avila/librechat:latest
    restart: always
    depends_on:
      - librechat_mongo
    environment:
      HOST: 0.0.0.0
      PORT: "3080"
      MONGO_URI: mongodb://librechat_mongo:27017/LibreChat
      CREDS_KEY: \${CREDS_KEY}
      CREDS_IV: \${CREDS_IV}
      JWT_SECRET: \${JWT_SECRET}
      JWT_REFRESH_SECRET: \${JWT_REFRESH_SECRET}
      ALLOW_REGISTRATION: \${ALLOW_REGISTRATION}
      ALLOW_EMAIL_LOGIN: "true"
    volumes:
      - librechat-images:/app/client/public/images
      - librechat-uploads:/app/uploads
  librechat_mongo:
    image: mongo:8
    restart: always
    command: mongod --noauth
    volumes:
      - librechat-mongo:/data/db
volumes:
  librechat-images:
  librechat-uploads:
  librechat-mongo:
`,
	},
	{
		id: "langflow",
		name: "Langflow",
		description:
			"Visual builder for LLM pipelines and agents — drag nodes together, test in the playground, expose the result as an API.",
		logo: "langflow",
		tags: ["ai", "llm", "low-code"],
		links: {
			website: "https://www.langflow.org",
			github: "https://github.com/langflow-ai/langflow",
			docs: "https://docs.langflow.org",
		},
		suggestedDomain: { serviceName: "langflow", port: 7860 },
		env: [
			{
				key: "POSTGRES_PASSWORD",
				default: "{{generateSecret}}",
				description: "Password of the langflow PostgreSQL user",
			},
		],
		compose: `services:
  langflow:
    image: langflowai/langflow:latest
    restart: always
    depends_on:
      - langflow_db
    environment:
      LANGFLOW_DATABASE_URL: postgresql://langflow:\${POSTGRES_PASSWORD}@langflow_db:5432/langflow
      LANGFLOW_HOST: 0.0.0.0
      LANGFLOW_PORT: "7860"
    volumes:
      - langflow-data:/app/langflow
  langflow_db:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_USER: langflow
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: langflow
    volumes:
      - langflow-db:/var/lib/postgresql/data
volumes:
  langflow-data:
  langflow-db:
`,
	},
	{
		id: "qdrant",
		name: "Qdrant",
		description:
			"Vector database for semantic search and RAG — filtered nearest-neighbour queries over embeddings, with a REST and gRPC API.",
		logo: "qdrant",
		tags: ["ai", "vector", "search"],
		links: {
			website: "https://qdrant.tech",
			github: "https://github.com/qdrant/qdrant",
			docs: "https://qdrant.tech/documentation/",
		},
		suggestedDomain: { serviceName: "qdrant", port: 6333 },
		env: [
			{
				key: "QDRANT_API_KEY",
				default: "{{generateSecret}}",
				description: "Sent as the `api-key` header; without it the whole database is public",
			},
		],
		compose: `services:
  qdrant:
    image: qdrant/qdrant:latest
    restart: always
    environment:
      QDRANT__SERVICE__API_KEY: \${QDRANT_API_KEY}
    volumes:
      - qdrant-storage:/qdrant/storage
volumes:
  qdrant-storage:
`,
	},
	{
		id: "localai",
		name: "LocalAI",
		description:
			"Drop-in OpenAI API replacement that runs models on your own CPU or GPU — chat, embeddings, images and audio.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/png/localai.png",
		tags: ["ai", "llm", "api"],
		links: {
			website: "https://localai.io",
			github: "https://github.com/mudler/LocalAI",
			docs: "https://localai.io/basics/getting_started/",
		},
		suggestedDomain: { serviceName: "localai", port: 8080 },
		env: [
			{
				key: "LOCALAI_API_KEY",
				default: "{{generateSecret}}",
				description: "Bearer token clients must send; leave empty to run the API unauthenticated",
			},
		],
		compose: `services:
  localai:
    image: localai/localai:latest
    restart: always
    environment:
      API_KEY: \${LOCALAI_API_KEY}
      THREADS: "4"
    volumes:
      - localai-models:/models
volumes:
  localai-models:
`,
	},
];
