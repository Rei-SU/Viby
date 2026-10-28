/**
 * SemVer comparison lives in `@shared/version` because both the main process
 * and the renderer compare versions. This re-export keeps the existing
 * `./version` imports in the updater unchanged.
 */
export * from '@shared/version'
