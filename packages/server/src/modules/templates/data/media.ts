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
    image: ghcr.io/advplyr/audiobookshelf:2.36.0
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
	{
		id: "komga",
		name: "Komga",
		description:
			"Comic and manga server — organises CBZ/CBR/PDF libraries, reads in the browser and speaks the OPDS protocol.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/komga.svg",
		tags: ["media", "comics", "books"],
		links: {
			website: "https://komga.org",
			github: "https://github.com/gotson/komga",
			docs: "https://komga.org/docs/introduction",
		},
		suggestedDomain: { serviceName: "komga", port: 25600 },
		env: [],
		compose: `services:
  komga:
    image: gotson/komga:latest
    restart: always
    environment:
      TZ: Etc/UTC
    volumes:
      - komga-config:/config
      - komga-books:/books
volumes:
  komga-config:
  komga-books:
`,
	},
	{
		id: "calibre-web",
		name: "Calibre-Web",
		description:
			"Browse, read and send an existing Calibre library — OPDS, Kobo sync and per-user shelves over the web.",
		logo: "calibreweb",
		tags: ["media", "books", "ebooks"],
		links: {
			website: "https://github.com/janeczku/calibre-web",
			github: "https://github.com/janeczku/calibre-web",
			docs: "https://github.com/janeczku/calibre-web/wiki",
		},
		suggestedDomain: { serviceName: "calibre-web", port: 8083 },
		env: [],
		compose: `services:
  calibre-web:
    image: lscr.io/linuxserver/calibre-web:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Etc/UTC
    volumes:
      - calibre-config:/config
      - calibre-books:/books
volumes:
  calibre-config:
  calibre-books:
`,
	},
	{
		id: "jellyseerr",
		name: "Jellyseerr",
		description:
			"Request portal for Jellyfin, Plex and Emby — users ask for a film or show, you approve, the *arr stack fetches it.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyseerr.svg",
		tags: ["media", "requests"],
		links: {
			website: "https://docs.jellyseerr.dev",
			github: "https://github.com/fallenbagel/jellyseerr",
			docs: "https://docs.jellyseerr.dev/getting-started/docker",
		},
		suggestedDomain: { serviceName: "jellyseerr", port: 5055 },
		env: [],
		compose: `services:
  jellyseerr:
    image: fallenbagel/jellyseerr:latest
    restart: always
    environment:
      TZ: Etc/UTC
      LOG_LEVEL: info
    volumes:
      - jellyseerr-config:/app/config
volumes:
  jellyseerr-config:
`,
	},
	{
		id: "sonarr",
		name: "Sonarr",
		description:
			"TV series manager — watches your indexers for new episodes, hands them to a download client and renames the result.",
		logo: "sonarr",
		tags: ["media", "tv", "automation"],
		links: {
			website: "https://sonarr.tv",
			github: "https://github.com/Sonarr/Sonarr",
			docs: "https://wiki.servarr.com/sonarr",
		},
		suggestedDomain: { serviceName: "sonarr", port: 8989 },
		env: [],
		compose: `services:
  sonarr:
    image: lscr.io/linuxserver/sonarr:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Etc/UTC
    volumes:
      - sonarr-config:/config
      - sonarr-media:/data
volumes:
  sonarr-config:
  sonarr-media:
`,
	},
	{
		id: "radarr",
		name: "Radarr",
		description:
			"Film counterpart to Sonarr — quality profiles, release monitoring and automatic imports into your library.",
		logo: "radarr",
		tags: ["media", "movies", "automation"],
		links: {
			website: "https://radarr.video",
			github: "https://github.com/Radarr/Radarr",
			docs: "https://wiki.servarr.com/radarr",
		},
		suggestedDomain: { serviceName: "radarr", port: 7878 },
		env: [],
		compose: `services:
  radarr:
    image: lscr.io/linuxserver/radarr:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Etc/UTC
    volumes:
      - radarr-config:/config
      - radarr-media:/data
volumes:
  radarr-config:
  radarr-media:
`,
	},
	{
		id: "prowlarr",
		name: "Prowlarr",
		description:
			"One indexer manager for the whole *arr stack — configure trackers once and every app inherits them.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/prowlarr.svg",
		tags: ["media", "indexers", "automation"],
		links: {
			website: "https://prowlarr.com",
			github: "https://github.com/Prowlarr/Prowlarr",
			docs: "https://wiki.servarr.com/prowlarr",
		},
		suggestedDomain: { serviceName: "prowlarr", port: 9696 },
		env: [],
		compose: `services:
  prowlarr:
    image: lscr.io/linuxserver/prowlarr:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Etc/UTC
    volumes:
      - prowlarr-config:/config
volumes:
  prowlarr-config:
`,
	},
	{
		id: "bazarr",
		name: "Bazarr",
		description:
			"Subtitle companion for Sonarr and Radarr — finds, scores and keeps subtitles in the languages you pick.",
		logo: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/bazarr.svg",
		tags: ["media", "subtitles", "automation"],
		links: {
			website: "https://www.bazarr.media",
			github: "https://github.com/morpheus65535/bazarr",
			docs: "https://wiki.bazarr.media",
		},
		suggestedDomain: { serviceName: "bazarr", port: 6767 },
		env: [],
		compose: `services:
  bazarr:
    image: lscr.io/linuxserver/bazarr:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Etc/UTC
    volumes:
      - bazarr-config:/config
      - bazarr-media:/data
volumes:
  bazarr-config:
  bazarr-media:
`,
	},
	{
		id: "qbittorrent",
		name: "qBittorrent",
		description:
			"BitTorrent client with a full web UI — categories, RSS rules and per-torrent limits, driven from the browser.",
		logo: "qbittorrent",
		tags: ["media", "downloads", "torrent"],
		links: {
			website: "https://www.qbittorrent.org",
			github: "https://github.com/qbittorrent/qBittorrent",
			docs: "https://github.com/qbittorrent/qBittorrent/wiki",
		},
		suggestedDomain: { serviceName: "qbittorrent", port: 8080 },
		env: [],
		compose: `services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    restart: always
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Etc/UTC
      WEBUI_PORT: "8080"
    volumes:
      - qbittorrent-config:/config
      - qbittorrent-downloads:/downloads
volumes:
  qbittorrent-config:
  qbittorrent-downloads:
`,
	},
];
