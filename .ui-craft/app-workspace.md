# Original frontend restored

The user requested the original design from before all redesign attempts. The app, public website, assets, component configuration and README are restored from `ec35e36`, which matches pre-Studio `60c80bf` for these surfaces. An exact source comparison covers 463 files without mismatches or extra frontend files. The maintenance page retains its encoded route folder so it remains reachable at `/__maintenance`.

Original fonts, palette, layout, navigation, cards, forms and website appearance are restored. No new design interpretation is applied. The current backend, dependencies, database, configuration, encryption keys, accounts, projects and settings remain in place. No primary reset, seed, database restore or migration.

Private verification/backups: `.nixploy-data/verification/original-restore/`. Both production builds, typechecks, strict Biome, knip, 119 web tests and 3,353 server tests pass (137 optional tests skipped). Browser verification covers 392 route/theme and 104 focused desktop/mobile captures. The original app runs on localhost:3000 and the original website on localhost:3373 using `.next-original-release` artifacts. Backups precede the switch; immediate comparisons match all 72 tables / 240 rows and 62 persistent configuration files. The original website retains its fixed dark presentation.

Sixteen final live checks pass against the existing session and application. Post-check preservation verifies every original audit row, all projects/accounts/configuration, and the original environment/type files; one audit row is appended and automatic update-check/platform-alert timestamps advance. No saved configuration changes.
