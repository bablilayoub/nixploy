# Native app rebuild

Current authority: [brief.md](brief.md). Earlier Fieldwork/Mobbin compositions are retired.

## Layout
Official sidebar-07 composition with contextual settings navigation, a compact header and a single main landmark. Sidebar preference is read from its existing cookie. At mobile sizes or enlarged text the native Sheet provides navigation.

Overview has compact metric Cards, an Item project list with environment links and a deployment activity Card beside it on wide screens. Service identity/actions live in a native Card, followed by canonical line Tabs and native configuration Tabs. No nested desktop task rail. Settings use one content column with native Cards and Fields. Shared data tables place controls above the framed rows and pagination below. Authentication uses the official login-03 composition. Failure, not-found and maintenance pages use native Empty.

## Component contract
Stock New York registry components. Item, Field and Progress are vendored from the official registry with imports normalized and minimal semantic/reflow guards. No package dependency additions. Neutral default palette, including neutral destructive/sidebar-primary roles. No bespoke component stylesheet. Existing user branding remains a configurable feature.

## Compatibility
No API, schema, deploy engine or encryption changes. Every existing query/mutation/key binding is preserved. Existing draft, permission, lifecycle, confirmation, keyboard, URL/hash alias, file-picker and long-operation contracts continue. Table containers and organization dialogs remain mounted across loading/sidebar transitions.

## Verification
Desktop routes in both themes; mobile/tablet and enlarged text; overlays and focus restoration; setup; navigation; data/config preservation at rollout. Evidence lives privately under `.nixploy-data/verification/native-rebuild/`.
