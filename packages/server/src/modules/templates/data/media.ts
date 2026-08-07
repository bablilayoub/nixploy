import type { TemplateData } from "../types";

export const mediaTemplates: TemplateData[] = [
	{
		id: "jellyfin",
		name: "Jellyfin",
		description:
			"Free software media system — stream movies, shows and music to any device with no strings attached.",
		logo: "jellyfin",
		tags: ["media", "video", "streaming"],
		links: {
			website: "https://jellyfin.org",
			github: "https://github.com/jellyfin/jellyfin",
			docs: "https://jellyfin.org/docs/",
		},
		suggestedDomain: { serviceName: "jellyfin", port: 8096 },
		env: [
			{
				key: "JELLYFIN_PUBLISHED_URL",
				default: "http://localhost:8096",
				description: "Public URL advertised to clients (e.g. https://media.example.com)",
			},
		],
		compose: `services:
  jellyfin:
    image: jellyfin/jellyfin:10
    restart: always
    environment:
      JELLYFIN_PublishedServerUrl: \${JELLYFIN_PUBLISHED_URL}
    volumes:
      - jellyfin-config:/config
      - jellyfin-cache:/cache
      - jellyfin-media:/media
volumes:
  jellyfin-config:
  jellyfin-cache:
  jellyfin-media:
`,
	},
	{
		id: "navidrome",
		name: "Navidrome",
		description:
			"Modern music server and streamer — your personal Spotify, compatible with Subsonic/Airsonic clients.",
		logo: "musicbrainz",
		tags: ["media", "music", "streaming"],
		links: {
			website: "https://www.navidrome.org",
			github: "https://github.com/navidrome/navidrome",
			docs: "https://www.navidrome.org/docs/",
		},
		suggestedDomain: { serviceName: "navidrome", port: 4533 },
		env: [],
		compose: `services:
  navidrome:
    image: deluan/navidrome:latest
    restart: always
    environment:
      ND_SCANSCHEDULE: 1h
      ND_LOGLEVEL: info
      ND_SESSIONTIMEOUT: 24h
      ND_BASEURL: ""
    volumes:
      - navidrome-data:/data
      - navidrome-music:/music
volumes:
  navidrome-data:
  navidrome-music:
`,
	},
	{
		id: "audiobookshelf",
		name: "Audiobookshelf",
		description:
			"Self-hosted audiobook and podcast server — stream to the web or the dedicated mobile apps.",
		logo: "audiobookshelf",
		tags: ["media", "audio", "books"],
		links: {
			website: "https://www.audiobookshelf.org",
			github: "https://github.com/advplyr/audiobookshelf",
			docs: "https://www.audiobookshelf.org/docs",
		},
		suggestedDomain: { serviceName: "audiobookshelf", port: 80 },
		env: [],
		compose: `services:
  audiobookshelf:
    image: ghcr.io/advplyr/audiobookshelf:2.9.0
    restart: always
    volumes:
      - audiobookshelf-audiobooks:/audiobooks
      - audiobookshelf-podcasts:/podcasts
      - audiobookshelf-config:/config
      - audiobookshelf-metadata:/metadata
volumes:
  audiobookshelf-audiobooks:
  audiobookshelf-podcasts:
  audiobookshelf-config:
  audiobookshelf-metadata:
`,
	},
	{
		id: "photoprism",
		name: "PhotoPrism",
		description:
			"AI-powered photo app — browse, organize and share your photo collection with automatic classification.",
		logo: "https://dl.photoprism.app/img/logo/logo.svg",
		tags: ["photos", "ai", "media"],
		links: {
			website: "https://www.photoprism.app",
			github: "https://github.com/photoprism/photoprism",
			docs: "https://docs.photoprism.app",
		},
		suggestedDomain: { serviceName: "photoprism", port: 2342 },
		env: [
			{
				key: "PHOTOPRISM_ADMIN_PASSWORD",
				default: "{{generateSecret}}",
				description: "Admin account password (min. 8 characters)",
			},
			{
				key: "PHOTOPRISM_SITE_URL",
				default: "http://localhost:2342/",
				description: "Public URL of this PhotoPrism instance",
			},
		],
		compose: `services:
  photoprism:
    image: photoprism/photoprism:latest
    restart: always
    environment:
      PHOTOPRISM_ADMIN_USER: admin
      PHOTOPRISM_ADMIN_PASSWORD: \${PHOTOPRISM_ADMIN_PASSWORD}
      PHOTOPRISM_SITE_URL: \${PHOTOPRISM_SITE_URL}
      PHOTOPRISM_AUTH_MODE: password
      PHOTOPRISM_DISABLE_TLS: "true"
      PHOTOPRISM_DATABASE_DRIVER: sqlite
    volumes:
      - photoprism-originals:/photoprism/originals
      - photoprism-storage:/photoprism/storage
volumes:
  photoprism-originals:
  photoprism-storage:
`,
	},
	{
		id: "kavita",
		name: "Kavita",
		description:
			"Fast, feature-rich reading server for manga, comics and ebooks — with OPDS and a slick reader.",
		logo: "https://raw.githubusercontent.com/Kareadita/Kavita/develop/UI/Web/src/assets/images/logo.png",
		tags: ["media", "books", "comics"],
		links: {
			website: "https://www.kavitareader.com",
			github: "https://github.com/Kareadita/Kavita",
			docs: "https://wiki.kavitareader.com",
		},
		suggestedDomain: { serviceName: "kavita", port: 5000 },
		env: [],
		compose: `services:
  kavita:
    image: jvmilazz0/kavita:latest
    restart: always
    volumes:
      - kavita-data:/kavita/config
      - kavita-library:/books
volumes:
  kavita-data:
  kavita-library:
`,
	},
];
