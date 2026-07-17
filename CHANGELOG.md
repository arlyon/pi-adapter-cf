# Changelog

## [0.1.3](https://github.com/arlyon/pi-adapter-cf/compare/pi-adapter-cf-v0.1.2...pi-adapter-cf-v0.1.3) (2026-07-17)


### Bug Fixes

* preserve event subscriptions after session hydration ([21d4107](https://github.com/arlyon/pi-adapter-cf/commit/21d4107e4595c48d83114d62ddad3718a811e01e))

## [0.1.2](https://github.com/arlyon/pi-adapter-cf/compare/pi-adapter-cf-v0.1.1...pi-adapter-cf-v0.1.2) (2026-06-26)


### Bug Fixes

* **storage:** advance leaf pointer when appending content entries ([0dd63dc](https://github.com/arlyon/pi-adapter-cf/commit/0dd63dc0b080347b623379612d1ed83381dc9e76))

## [0.1.1](https://github.com/arlyon/pi-adapter-cf/compare/pi-adapter-cf-v0.1.0...pi-adapter-cf-v0.1.1) (2026-05-20)


### Features

* add AJV stub, fix CF Workers compatibility, add repo metadata ([5c8df0f](https://github.com/arlyon/pi-adapter-cf/commit/5c8df0fc9aebe97e93ad67d3ab6975f5341c6fb4))
* add configurable max tool calls per prompt ([e4dde0b](https://github.com/arlyon/pi-adapter-cf/commit/e4dde0b93a9c5b7d1e66b2a466903f4a3bdf9618))
* add CRAP metrics with vitest coverage and agent-session-do tests ([9dfb56b](https://github.com/arlyon/pi-adapter-cf/commit/9dfb56b9ae66803a979cc4adc0ea3e38a55cb9b8))
* add DOSessionStorage implementing pi-agent-core SessionStorage ([a6f26cb](https://github.com/arlyon/pi-adapter-cf/commit/a6f26cb33a16523269205aa2c454260f53ea310e))
* add REST endpoint for session usage ([726b32c](https://github.com/arlyon/pi-adapter-cf/commit/726b32cea9e562a9517f0d7b5afc24f491d3b354))
* add session context (Ctx generic) for per-request state ([f3e9350](https://github.com/arlyon/pi-adapter-cf/commit/f3e935006278cc14c019ec0745f2749b9fcfdabe))
* add session tree REST routes to worker router ([70f05ab](https://github.com/arlyon/pi-adapter-cf/commit/70f05abd7b9be6e8ae1e547555fa015ffc3a7a6b))
* add SessionUsage type and onUsage config callback ([6dc2699](https://github.com/arlyon/pi-adapter-cf/commit/6dc26999266b7086d8e99332b2685619beb1c083))
* fork as pi-adapter-cf with [@earendil-works](https://github.com/earendil-works) dependencies ([fe2fc6a](https://github.com/arlyon/pi-adapter-cf/commit/fe2fc6a0f70ea600123cd03221b6d0cae74dfd45))
* initialize pi-agent-cf SDK with Durable Object support ([dedb78d](https://github.com/arlyon/pi-adapter-cf/commit/dedb78d5358c4355951c86a591c051e2166a61d3))
* wire pi-agent-core Session into Durable Object persistence ([aa1aa05](https://github.com/arlyon/pi-adapter-cf/commit/aa1aa059baecf8429aec32cf55f4ac049a0d4bbe))
* wire usage accumulation into agent event subscriber ([9ea778f](https://github.com/arlyon/pi-adapter-cf/commit/9ea778f1c39616910924770537b9188cf158534d))


### Bug Fixes

* update Agent API for pi-agent-core v0.75 ([dbb095c](https://github.com/arlyon/pi-adapter-cf/commit/dbb095c0efec8c00feeb6f77af5e57134223ead9))
